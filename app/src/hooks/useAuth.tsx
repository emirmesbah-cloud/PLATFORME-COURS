/**
 * useAuth — gestion d'authentification + session unique active.
 *
 * Single Active Session :
 *   - Au login, on claim un nouveau session_id (UUID) côté DB et en localStorage.
 *   - Une subscription Realtime écoute les UPDATE sur ton profile.
 *   - Si quelqu'un se connecte avec le même compte ailleurs → la DB est mise
 *     à jour → on reçoit l'event en temps réel → on compare → mismatch → logout.
 *   - Au boot avec un JWT existant, on verify_session() → logout si invalidée.
 *
 * Effet : un seul appareil peut être actif à la fois par compte. Login sur
 * device B délogue automatiquement device A.
 *
 * SLOW-ISP HARDENING (port from Naim platform — same root cause: students sur
 * ISP Algérien lent vers Supabase EU prenaient 30s+ avant de voir le dashboard,
 * et certains se faisaient bouncer vers /activate à cause du race condition
 * entre `session set` et `profile loaded`). Trois mécanismes :
 *
 *   1. JWT-stub profile : on construit un Profile minimal depuis les claims du
 *      JWT (pas de network call). AuthGuard passe immédiatement.
 *   2. localStorage cache (24h TTL) : on hydrate avec le dernier profile connu.
 *   3. Non-blocking bootstrap : setIsLoading(false) AVANT getSession async →
 *      la page render en <100ms, le profile arrive en background.
 *   4. INITIAL_SESSION handler : event fire au restore d'une session JWT du
 *      localStorage → on charge le profile + subscribe (sans re-claim).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User, RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { setSentryUser } from '@/lib/sentry';
import type { Profile } from '@/lib/types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  isAdmin: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_STORAGE_KEY = 'aurel-active-session-id';

function readLocalSessionId(): string | null {
  try { return localStorage.getItem(SESSION_STORAGE_KEY); } catch { return null; }
}
function writeLocalSessionId(id: string | null) {
  try {
    if (id) localStorage.setItem(SESSION_STORAGE_KEY, id);
    else    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
}

// Timeout wrapper — empêche un RPC qui hang (lock steal, réseau mort, SW
// fantôme) de bloquer le bootstrap auth indéfiniment. Reject = on continue
// avec profile=null plutôt que de laisser isLoading à true à vie.
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`[Aurel] ${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

// AbortError: Lock broken by another request with the 'steal' option.
// Bénin : un autre onglet / le SW / un retry interne a volé le lock auth.
// On ignore sans casser le bootstrap.
function isLockAbortError(e: unknown): boolean {
  if (!e) return false;
  const msg = (e as { message?: string }).message || String(e);
  return /Lock broken|AbortError/i.test(msg);
}

// Decode JWT payload (no verification, just claims read).
function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

// Construit un profile MINIMAL depuis le JWT (sans appel réseau).
// Le JWT Supabase contient :
//   - sub (user_id)
//   - email
//   - user_metadata : { first_name, last_name, whatsapp } (set au createUser)
//
// On peut donc afficher un dashboard fonctionnel IMMÉDIATEMENT après login
// sans attendre la query profiles. C'est critique pour les users avec ISP
// lent qui auraient sinon attendu 30s+ avant de voir l'app.
//
// La query profiles tourne ensuite en arrière-plan et REMPLACE ce stub par
// les vraies données (incluant tier, is_admin). Si tier ou is_admin change,
// le UI re-render naturellement.
//
// Default tier='accompagne' = safe default (le tier réel arrive avec la
// query DB juste après). is_admin=false par défaut (admins seront détectés
// quand le profile DB arrive).
function profileFromJwt(session: Session | null): Profile | null {
  if (!session?.access_token || !session.user) return null;
  const payload = decodeJwtPayload(session.access_token);
  const userMeta = (payload?.user_metadata ?? session.user.user_metadata ?? {}) as {
    first_name?: string;
    last_name?: string;
    whatsapp?: string;
  };
  const nowIso = new Date().toISOString();
  return {
    id:               session.user.id,
    email:            session.user.email ?? '',
    first_name:       userMeta.first_name ?? '',
    last_name:        userMeta.last_name ?? '',
    whatsapp:         userMeta.whatsapp ?? '',
    tier:             'accompagne',
    is_admin:         false,
    activated_at:     nowIso,
    diplome_algerien: null,
    created_at:       nowIso,
    last_login_at:    null,
  } as Profile;
}

// LocalStorage cache du profile — critique pour les users avec ISP lent.
// Sans ça : query profiles timeout → AuthGuard fallback /activate → user
// revient à la case départ sur chaque visite. Avec cache : on hydrate
// instantanément avec le dernier profile connu, on update en background.
// TTL = 24h. Au-delà, on refait une query DB au boot.
const PROFILE_CACHE_KEY = 'aurel:profile-cache:v1';
const PROFILE_CACHE_TTL_MS = 24 * 3600 * 1000;

interface CachedProfile {
  userId: string;
  profile: Profile;
  cachedAt: number;
}

function readCachedProfile(userId: string): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const cached: CachedProfile = JSON.parse(raw);
    if (cached.userId !== userId) return null;
    if (Date.now() - cached.cachedAt > PROFILE_CACHE_TTL_MS) return null;
    return cached.profile;
  } catch { return null; }
}

function writeCachedProfile(userId: string, profile: Profile) {
  try {
    const cached: CachedProfile = { userId, profile, cachedAt: Date.now() };
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(cached));
  } catch {}
}

function clearCachedProfile() {
  try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Refs pour éviter les fuites mémoire et garder la valeur stable dans les callbacks
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const isSigningOutRef = useRef(false);

  /**
   * Charge le profile via SELECT direct sur profiles.
   *
   * NETWORK RESILIENCE :
   *   - Étape 1 : hydrate immédiatement via cache OU stub JWT (zéro latence).
   *   - Étape 2 : query DB en background avec retry 3x (300ms / 600ms / 900ms)
   *     + timeout 12s par tentative. Si tout échoue, on garde le profile
   *     précédent — AuthGuard ne fallback PAS vers /activate car profile≠null.
   *
   * On ne fait PAS de signOut auto en cas d'échec : ça créait une boucle
   * activate↔dashboard chez les users sur ISP lent. La query est best-effort
   * — AuthGuard tranche à la fin via son propre timeout 30s.
   */
  const loadProfile = useCallback(async (userId: string): Promise<void> => {
    // Étape 1a : cache valide → use it immediately
    const cached = readCachedProfile(userId);
    if (cached) {
      setProfile(cached);
      setSentryUser({
        id: cached.id, email: cached.email,
        tier: cached.tier, is_admin: cached.is_admin,
      });
    } else {
      // Étape 1b : pas de cache → stub depuis le JWT courant.
      // Bullet-proof : même sans aucun call réseau, le user a un profile
      // de base affiché. AuthGuard passe vers /dashboard.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const stub = profileFromJwt(session);
        if (stub && stub.id === userId) {
          setProfile(stub);
          setSentryUser({ id: stub.id, email: stub.email, tier: stub.tier, is_admin: stub.is_admin });
        }
      } catch {}
    }

    // Étape 2 : query DB pour valider/rafraîchir. Si timeout, le cache reste
    // en place — pas de fallback /activate car AuthGuard voit profile !== null.
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let data: Profile | null = null;
      let error: unknown = null;
      try {
        const result = await withTimeout<{ data: Profile | null; error: unknown }>(
          supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle() as unknown as PromiseLike<{ data: Profile | null; error: unknown }>,
          12000,
          `loadProfile attempt ${attempt}`,
        );
        data = result.data;
        error = result.error;
      } catch (e) {
        error = e;
      }

      if (!error) {
        if (data) {
          setProfile(data);
          writeCachedProfile(userId, data);
          setSentryUser({
            id: data.id, email: data.email,
            tier: data.tier, is_admin: data.is_admin,
          });
        } else {
          // No row : profile inexistant. On clear le cache mais on ne signOut PAS
          // (AuthGuard décidera côté UI sans tuer la session JWT — ça évite la
          // boucle activate↔dashboard si la query renvoie null par erreur RLS
          // transitoire).
          setProfile(null);
          clearCachedProfile();
          setSentryUser(null);
        }
        return;
      }

      lastError = error;
      // eslint-disable-next-line no-console
      console.warn(`[Aurel] loadProfile attempt ${attempt} failed`, lastError);
      if (attempt < 3) await new Promise(r => setTimeout(r, 300 * attempt));
    }

    // Après 3 échecs : on garde le profile précédent (s'il y en a un) plutôt
    // que de cascader en signOut.
    // eslint-disable-next-line no-console
    console.error('[Aurel] loadProfile failed 3x, keeping previous state', lastError);
  }, []);

  /**
   * Force un logout local + clear de la session_id locale.
   * Affiche optionnellement un toast (via window event pour découpler le hook
   * du composant Toast).
   */
  const forceSignOut = useCallback(
    async (reason?: 'kicked' | 'verify_failed') => {
      if (isSigningOutRef.current) return;
      isSigningOutRef.current = true;
      try {
        writeLocalSessionId(null);
        if (realtimeChannelRef.current) {
          await supabase.removeChannel(realtimeChannelRef.current);
          realtimeChannelRef.current = null;
        }
        // SECURITY : scope:'global' révoque le refresh token côté SERVEUR.
        // Sans ça, un attaquant qui aurait exfiltré le refresh token pourrait
        // continuer à l'utiliser après le logout.
        await supabase.auth.signOut({ scope: 'global' });
        setSession(null);
        setProfile(null);
        clearCachedProfile();

        if (reason === 'kicked') {
          window.dispatchEvent(
            new CustomEvent('aurel:kicked', {
              detail: {
                message:
                  'Vous avez été déconnecté car votre compte est utilisé sur un autre appareil.',
              },
            })
          );
        }
      } finally {
        isSigningOutRef.current = false;
      }
    },
    []
  );

  /**
   * Subscribe au realtime sur la ligne profile de l'utilisateur. Si
   * `current_session_id` change vers un ID qui n'est pas le nôtre → kick.
   *
   * Narrow filter (port from Naim) : on compare new vs old côté client puis
   * ignore si current_session_id n'a pas changé. Évite de kicker l'user à
   * chaque update cosmétique de son profile (typo dans first_name, etc.).
   */
  const subscribeToProfile = useCallback(
    (userId: string) => {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }

      const channel = supabase
        .channel(`profile-session:${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'profiles',
            filter: `id=eq.${userId}`,
          },
          (payload) => {
            const newRow = payload.new as { current_session_id?: string | null };
            const oldRow = payload.old as { current_session_id?: string | null };
            const sidChanged = newRow?.current_session_id !== oldRow?.current_session_id;
            if (!sidChanged) return; // ignore les updates non pertinents

            const newSid = newRow?.current_session_id;
            if (!newSid) return;
            const localSid = readLocalSessionId();
            if (localSid && newSid !== localSid) {
              forceSignOut('kicked');
            }
          }
        )
        .subscribe();

      realtimeChannelRef.current = channel;
    },
    [forceSignOut]
  );

  /**
   * Claim une nouvelle session côté DB (RPC) + stocke l'ID en localStorage.
   * IMPORTANT : on écrit en localStorage AVANT que la subscription Realtime
   * ne reçoive notre propre UPDATE event, sinon race condition → on se kicke
   * nous-mêmes. La RPC retourne le nouvel UUID qu'elle vient de générer.
   */
  const claimSession = useCallback(async () => {
    type ClaimData = { ok?: boolean; session_id?: string; error?: string } | null;
    let data: ClaimData = null;
    let error: unknown = null;
    try {
      const result = await withTimeout<{ data: ClaimData; error: unknown }>(
        supabase.rpc('claim_session') as unknown as PromiseLike<{ data: ClaimData; error: unknown }>,
        6000,
        'claim_session',
      );
      data = result.data;
      error = result.error;
    } catch (e) {
      error = e;
    }
    if (error || !data?.ok) {
      // eslint-disable-next-line no-console
      console.warn('[Aurel] claim_session failed', error || data);
      return;
    }
    if (data.session_id) writeLocalSessionId(data.session_id);
  }, []);

  /**
   * Verify la session locale contre la DB. Appelé au boot avec un JWT existant.
   */
  const verifyLocalSession = useCallback(async () => {
    const localSid = readLocalSessionId();
    if (!localSid) {
      await claimSession();
      return;
    }
    type VerifyData = { ok?: boolean; error?: string; note?: string } | null;
    let data: VerifyData = null;
    let error: unknown = null;
    try {
      const result = await withTimeout<{ data: VerifyData; error: unknown }>(
        supabase.rpc('verify_session', { p_session_id: localSid }) as unknown as PromiseLike<{ data: VerifyData; error: unknown }>,
        6000,
        'verify_session',
      );
      data = result.data;
      error = result.error;
    } catch (e) {
      error = e;
    }
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[Aurel] verify_session error', error);
      return; // tolérant : pas de logout sur erreur réseau
    }
    if (!data?.ok) {
      await forceSignOut('verify_failed');
    }
  }, [claimSession, forceSignOut]);

  useEffect(() => {
    let mounted = true;

    // 1. Bootstrap NON-BLOCKING (port from Naim platform) :
    //
    // Avant : on awaitait getSession (15s timeout), puis loadProfile (36s
    // total avec retries), puis setIsLoading(false). Sur ISP lent, total =
    // 50s+ de spinner blanc avant que la page apparaisse.
    //
    // Maintenant : on read SYNCHRONOUSLY la session depuis localStorage
    // (sans network call) et on setIsLoading(false) IMMÉDIATEMENT. La page
    // s'affiche en <100ms.
    //
    // En arrière-plan, getSession() valide/refresh le token + loadProfile.
    // Quand ils résolvent, le state se met à jour → re-render automatique.
    (async () => {
      // Étape 1 : lecture synchrone du state local de supabase-js (instant).
      // supabase-js HYDRATE la session depuis localStorage de manière
      // synchrone à la construction du client, donc storage est déjà rempli.
      let localSession: Session | null = null;
      try {
        const localSessionStr = localStorage.getItem('aurel-academy-auth');
        if (localSessionStr) {
          try {
            const parsed = JSON.parse(localSessionStr);
            localSession = parsed?.currentSession ?? parsed?.session ?? null;
            if (localSession?.user && mounted) {
              setSession(localSession);

              // CRITICAL : si on a un cache profile pour ce user → use it.
              // Sinon → construire un profile STUB depuis le JWT pour que
              // AuthGuard passe immédiatement vers /dashboard sans attendre
              // la query DB. Cas typique : user en première activation sur
              // ISP ULTRA lent, OU user qui se connecte sur un nouveau device.
              const cached = readCachedProfile(localSession.user.id);
              if (cached) {
                setProfile(cached);
                setSentryUser({ id: cached.id, email: cached.email, tier: cached.tier, is_admin: cached.is_admin });
              } else {
                const stub = profileFromJwt(localSession);
                if (stub) {
                  setProfile(stub);
                  setSentryUser({ id: stub.id, email: stub.email, tier: stub.tier, is_admin: stub.is_admin });
                }
              }
            }
          } catch {}
        }
      } catch {}

      // Étape 2 : setIsLoading(false) IMMÉDIATEMENT — page peut render.
      // AuthGuard utilise ses propres timers + spinners pour les transitions.
      if (mounted) setIsLoading(false);

      // Étape 3 : EN BACKGROUND — getSession officiel pour valider/refresh
      // + loadProfile. Le state se met à jour si ces calls résolvent.
      // Aucun await ne bloque le render initial.
      (async () => {
        let existingSession: Session | null = null;
        try {
          const result = await withTimeout(
            supabase.auth.getSession(),
            15000,
            'getSession',
          );
          existingSession = result.data.session;
          if (mounted) setSession(existingSession);
        } catch (e) {
          if (!isLockAbortError(e)) {
            // eslint-disable-next-line no-console
            console.warn('[Aurel] getSession bg failed (slow ISP?)', e);
          }
          // Continue avec ce qu'on a (session lue synchrone du localStorage)
        }

        if (existingSession?.user && mounted) {
          try { subscribeToProfile(existingSession.user.id); }
          catch (e) { console.warn('[Aurel] subscribeToProfile bg error', e); }
          try { await loadProfile(existingSession.user.id); }
          catch (e) {
            if (!isLockAbortError(e)) console.warn('[Aurel] loadProfile bg error', e);
          }
          // Side effects non-critiques en parallèle
          verifyLocalSession().catch((e) => {
            if (!isLockAbortError(e)) console.warn('[Aurel] verifyLocalSession bg error', e);
          });
          supabase.rpc('touch_last_login').then(() => {}, () => {});
        }
      })();
    })();

    // 2. Auth state changes — déduplique avec le bootstrap pour éviter
    // double claim/subscribe si Supabase JS fire SIGNED_IN au restore.
    let lastHandledUserId: string | null = null;
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession);

      // CRITICAL FIX (port from Naim) : INITIAL_SESSION fire au boot quand
      // supabase-js restore une session existante du localStorage. Avant
      // ce fix, on ne le gérait pas → loadProfile pas appelé sur les users
      // qui revenaient sur l'app → AuthGuard restait avec profile=null →
      // fallback /activate après 6s.
      // Maintenant : on charge le profile, on subscribe au realtime, MAIS
      // on n'appelle PAS claim_session (le bootstrap verifyLocalSession s'en
      // charge en background si nécessaire).
      if (event === 'INITIAL_SESSION' && newSession?.user) {
        if (lastHandledUserId === newSession.user.id) return;
        lastHandledUserId = newSession.user.id;
        // STUB profile depuis JWT immédiatement (cache hit OR JWT decode)
        // → AuthGuard passe sans attendre la query DB même sur ISP très lent
        const cached = readCachedProfile(newSession.user.id);
        if (cached) setProfile(cached);
        else {
          const stub = profileFromJwt(newSession);
          if (stub) setProfile(stub);
        }
        try { subscribeToProfile(newSession.user.id); } catch {}
        try { await loadProfile(newSession.user.id); } catch (e) {
          if (!isLockAbortError(e)) console.warn('[Aurel] loadProfile on INITIAL_SESSION failed', e);
        }
        return;
      }

      if (event === 'SIGNED_IN' && newSession?.user) {
        if (lastHandledUserId === newSession.user.id) return;
        lastHandledUserId = newSession.user.id;
        // SAME : stub profile from JWT immediately so dashboard renders
        // without waiting query DB. Critical for first login on slow ISP.
        const cachedSi = readCachedProfile(newSession.user.id);
        if (cachedSi) setProfile(cachedSi);
        else {
          const stub = profileFromJwt(newSession);
          if (stub) setProfile(stub);
        }

        // RACE FIX : on N'attache PAS subscribeToProfile avant que claim_session
        // ait écrit le nouveau session_id en localStorage. Sinon : RPC écrit
        // current_session_id en DB → realtime broadcast notre propre UPDATE →
        // handler compare new_sid vs OLD localSid → mismatch →
        // forceSignOut('kicked') de l'utilisateur légitime.
        await claimSession();

        // Subscribe APRÈS que la nouvelle session_id soit en localStorage.
        subscribeToProfile(newSession.user.id);

        await loadProfile(newSession.user.id);
      } else if (event === 'TOKEN_REFRESHED' && newSession?.user) {
        // Refresh JWT silencieux → on touche à rien sauf si le profile manque
        if (!profile) await loadProfile(newSession.user.id);
      } else if (event === 'SIGNED_OUT') {
        lastHandledUserId = null;
        if (realtimeChannelRef.current) {
          await supabase.removeChannel(realtimeChannelRef.current);
          realtimeChannelRef.current = null;
        }
        writeLocalSessionId(null);
        setProfile(null);
        clearCachedProfile();
        setSentryUser(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SINGLE-SESSION HARDENING — Safety net si Realtime down.
  // Poll DB toutes les 3 min, mais SEULEMENT quand l'onglet est visible —
  // user en arrière-plan ne consomme pas DB. Au visibility change (retour
  // sur l'onglet après une longue absence), on poll immédiatement.
  useEffect(() => {
    if (!session?.user) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      verifyLocalSession().catch(() => {});
    };
    const interval = setInterval(tick, 180_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session?.user?.id, verifyLocalSession]);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return;
    await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const signOut = useCallback(async () => {
    writeLocalSessionId(null);
    if (realtimeChannelRef.current) {
      await supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
    // scope:'global' = révoque le refresh token serveur-side (vs 'local' qui
    // ne nettoie que le localStorage). Empêche un attaquant qui aurait
    // exfiltré le JWT/refresh de continuer à l'utiliser après le logout user.
    await supabase.auth.signOut({ scope: 'global' });
    setSession(null);
    setProfile(null);
    clearCachedProfile();
    setSentryUser(null);
  }, []);

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    profile,
    isLoading,
    isAdmin: !!profile?.is_admin,
    refreshProfile,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
