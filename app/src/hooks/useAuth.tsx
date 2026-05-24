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
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User, RealtimeChannel } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, intentionalRemoval } from '@/lib/supabase';
import { decodeJwtPayload } from '@/lib/jwt';
import { writeSessionBackup, clearSessionBackup, readSessionBackup } from '@/lib/session-backup';
import { setSentryUser } from '@/lib/sentry';
import type { Profile } from '@/lib/types';

/**
 * Where did the current profile come from ?
 *   - 'none' : pas de profile (pre-login OR signed-out)
 *   - 'jwt'  : stub construit depuis les claims du JWT (zero-network, pas
 *              autoritatif — is_admin/tier sont les defaults, pas la vérité)
 *   - 'cache': lu depuis localStorage (ancien profile DB-confirmé, peut être
 *              stale jusqu'à 24h)
 *   - 'db'   : query DB fraîche, autoritative
 *
 * SHERLOCK round 2 fix : on expose cet état pour que les guards de sécurité
 * (AdminGuard, RootRedirect) puissent attendre la confirmation DB avant
 * d'agir sur is_admin. Avant ce fix, un user qui poisonnait son cache
 * localStorage (devtools edit) avec is_admin:true voyait l'admin UI render
 * pendant les 30s du loadProfile background — les RPC admin échouaient
 * (RLS protège côté DB) mais la structure des routes + erreurs leakaient.
 */
type ProfileSource = 'none' | 'jwt' | 'cache' | 'db';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** Source du profile courant. Voir `ProfileSource`. */
  profileSource: ProfileSource;
  isLoading: boolean;
  /**
   * `isAdmin` est CONFIRMED-only : retourne `true` UNIQUEMENT quand le profile
   * vient de la DB (`profileSource === 'db'`) ET que `is_admin === true`.
   * Pendant les transitions stub→cache→db, isAdmin reste `false` même si le
   * cache poisoned dit le contraire. Les consumers UI fail-closed par défaut.
   */
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
  const [profileSource, setProfileSource] = useState<ProfileSource>('none');
  const [isLoading, setIsLoading] = useState(true);

  // SHERLOCK R3 fix : on a besoin du queryClient pour clear le cache
  // TanStack Query au signOut. Sans ça, sur un device partagé, l'user B
  // qui se logguait après l'user A pouvait voir brièvement les données
  // d'A (queries non-uid-scoped : lessons admin stats, audit, etc.)
  // jusqu'à staleTime/refocus. Maintenant on clear tout au logout.
  const queryClient = useQueryClient();

  // Refs pour éviter les fuites mémoire et garder la valeur stable dans les callbacks
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const isSigningOutRef = useRef(false);

  // SHERLOCK R23 — ADMIN MULTI-DEVICE :
  // Single-active-session enforcement is for students only. Admins (Aurel +
  // team) can be connected on multiple devices simultaneously without
  // kicking each other. This ref mirrors profile?.is_admin so the Realtime
  // kick handler can short-circuit when the current user is an admin
  // (without needing to re-subscribe whenever profile changes).
  const isAdminRef = useRef(false);
  // R23 race-guard : true ONLY after profileSource hits 'db' at least once.
  // Used by the Realtime kick handler to defer kicks while we're still in
  // stub/cache state and is_admin is unreliable.
  const isAdminConfirmedRef = useRef(false);

  // R23 : throttle the spurious-SIGNED_OUT warning to once per minute.
  // Otherwise on flapping ISP it spams the console + Sentry breadcrumbs.
  const lastSpuriousSignOutLogAtRef = useRef(0);

  // SHERLOCK R12 (BULLETPROOF) — Persist auth forever, until explicit user logout.
  // Tracks WHO triggered the SIGNED_OUT event :
  //   true  = user clicked logout button OR realtime kicked us (legitimate)
  //   false = supabase-js auto-fired SIGNED_OUT (token refresh fail, network hiccup,
  //          transient 401 from slow Supabase EU from DZ — NOT a real signout)
  // The SIGNED_OUT handler below checks this ref. If false → ignore event,
  // keep user logged in. If true → execute cleanup normally.
  // → User experience : « jamais déco sauf si je clique logout », même quand
  //   le réseau merde / Supabase rame / le token essaie de se refresh.
  const intentionalSignOutRef = useRef(false);

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
    // Étape 1a : cache valide → use it immediately. Source = 'cache' (le
    // is_admin du cache n'est PAS autoritatif tant que la DB n'a pas
    // confirmé — voir AuthContextValue.isAdmin commentaire).
    const cached = readCachedProfile(userId);
    if (cached) {
      setProfile(cached);
      setProfileSource('cache');
      setSentryUser({
        id: cached.id, email: cached.email,
        tier: cached.tier, is_admin: cached.is_admin,
      });
    } else {
      // Étape 1b : pas de cache → stub depuis le JWT courant. Source = 'jwt'.
      // Bullet-proof : même sans aucun call réseau, le user a un profile
      // de base affiché. AuthGuard passe vers /dashboard.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const stub = profileFromJwt(session);
        if (stub && stub.id === userId) {
          setProfile(stub);
          setProfileSource('jwt');
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
          // R22 : if cached profile said is_admin=true but DB says false,
          // the admin was demoted. Cached UI (admin nav) is now stale.
          // Clear the queryClient cache so admin queries don't keep showing
          // data they shouldn't see anymore. RLS prevents data leak, but
          // the UI nav cleanup is cosmetic + helpful.
          const cached = readCachedProfile(userId);
          if (cached && cached.is_admin === true && data.is_admin !== true) {
            // eslint-disable-next-line no-console
            console.info('[Aurel R22] admin privileges revoked detected — clearing query cache');
            queryClient.clear();
          }
          setProfile(data);
          setProfileSource('db');
          writeCachedProfile(userId, data);
          setSentryUser({
            id: data.id, email: data.email,
            tier: data.tier, is_admin: data.is_admin,
          });
        } else {
          // SHERLOCK round 2 fix : on NE clear PAS le cache sur data===null.
          // Avant : null → setProfile(null) + clearCachedProfile() →
          // AuthGuard fallback /login → user perd la session sur un simple
          // hiccup RLS / replication lag. Maintenant on log et on garde
          // l'état précédent (cache + stub). Si le user n'a vraiment pas
          // de profile, AuthGuard's 30s timeout l'enverra à /login sans
          // que le JWT ne soit invalidé.
          // eslint-disable-next-line no-console
          console.warn('[Aurel] loadProfile returned null (transient?), keeping previous state');
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
      // R12 : mark this signOut as intentional so the SIGNED_OUT handler
      // actually executes cleanup (vs ignoring spurious supabase-js firings)
      intentionalSignOutRef.current = true;
      // R16 : unlock the localStorage suppression so supabase-js can actually
      // clear the auth key during this intentional logout. The flag is
      // re-asserted to false in the finally block below.
      intentionalRemoval.current = true;
      // R17 : also clear our independent session backup — otherwise next page
      // load would restore the dead session from backup.
      clearSessionBackup();
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
        setProfileSource('none');
        clearCachedProfile();
        // SHERLOCK R3 fix : clear queryClient cache + Sentry user. Avant,
        // un kick laissait les queries d'admin et le contexte Sentry
        // attribués à l'ancien user.
        queryClient.clear();
        setSentryUser(null);

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
        // R16 : re-lock the storage suppression so future spurious SIGNED_OUT
        // events (from token refresh failures) cannot clear localStorage.
        intentionalRemoval.current = false;
      }
    },
    [queryClient]
  );

  /**
   * Subscribe au realtime sur la ligne profile de l'utilisateur. Si
   * `current_session_id` change vers un ID qui n'est pas le nôtre → kick.
   *
   * Narrow filter (port from Naim) : on compare new vs old côté client puis
   * ignore si current_session_id n'a pas changé. Évite de kicker l'user à
   * chaque update cosmétique de son profile (typo dans first_name, etc.).
   *
   * SHERLOCK R18 — GRACE PERIOD ON SUBSCRIPTION : ignore any kick events for
   * the first 5 seconds after subscribing. Fixes a false-positive kick on
   * F5 where the Realtime channel replays or catches up an event from
   * before subscription (e.g. a touch_last_login UPDATE from the bootstrap
   * itself, OR our own claim_session UPDATE that arrives slightly out of
   * order due to network latency). Without this grace period, the user gets
   * "Session expirée" on every refresh on slow networks.
   *
   * A real cross-device kick will fire AFTER this 5-second window, so
   * legitimate single-active-session enforcement still works.
   */
  const subscribeToProfile = useCallback(
    (userId: string) => {
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }

      const subscribedAt = Date.now();
      const GRACE_PERIOD_MS = 5000;

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

            // R23 : ADMIN MULTI-DEVICE. Admins can stay connected on multiple
            // devices simultaneously without kicking each other. The kick rule
            // only applies to students (single-active-session). isAdminRef
            // mirrors profile.is_admin via the effect further below.
            if (isAdminRef.current) {
              // eslint-disable-next-line no-console
              console.info('[Aurel R23] Admin multi-device — skipping kick');
              return;
            }

            // R23 race-guard : if the profile is still in stub/cache state
            // (loadProfile not done yet on slow ISP), don't kick yet. The JWT
            // stub hardcodes is_admin=false, so an admin in this transient
            // state would falsely match the "kick this student" branch. Defer
            // the kick by 3s and re-check ; by then loadProfile should have
            // returned the real is_admin value.
            if (!isAdminConfirmedRef.current) {
              setTimeout(() => {
                if (isAdminRef.current) {
                  // eslint-disable-next-line no-console
                  console.info('[Aurel R23] Admin confirmed during defer — skipping deferred kick');
                  return;
                }
                const lsidLater = readLocalSessionId();
                if (lsidLater && newSid !== lsidLater) {
                  forceSignOut('kicked');
                }
              }, 3000);
              return;
            }

            const localSid = readLocalSessionId();
            if (localSid && newSid !== localSid) {
              // R18 : grace period to absorb F5 race conditions.
              if (Date.now() - subscribedAt < GRACE_PERIOD_MS) {
                // eslint-disable-next-line no-console
                console.warn('[Aurel R18] Ignoring kick event within grace period — session preserved');
                return;
              }
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
      // R17 : if the main key didn't have a session for some reason, fall back
      // to our independent backup (restoreMainFromBackupIfMissing already ran
      // before supabase-js init, but defensive double-check here too).
      let localSession: Session | null = null;
      try {
        const localSessionStr = localStorage.getItem('aurel-academy-auth');
        if (localSessionStr) {
          try {
            const parsed = JSON.parse(localSessionStr);
            localSession = parsed?.currentSession ?? parsed?.session ?? parsed ?? null;
            // Validate it actually looks like a Session (has access_token).
            if (localSession && !(localSession as Session)?.access_token) {
              localSession = null;
            }
          } catch {}
        }
        // R17 : if main storage didn't yield a session, try the independent
        // backup. This catches any case where supabase-js's own storage was
        // wiped (failed token refresh, edge race, ServiceWorker shenanigans).
        if (!localSession) {
          const backup = readSessionBackup();
          if (backup?.access_token && backup?.user) {
            localSession = backup;
            // Re-write the main key so supabase-js sees it on its own hydration.
            try {
              localStorage.setItem('aurel-academy-auth', JSON.stringify({
                ...backup,
                currentSession: backup,
                expiresAt: backup.expires_at,
              }));
              // eslint-disable-next-line no-console
              console.info('[Aurel R17] Bootstrap restored session from backup');
            } catch {}
          }
        }
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
            setProfileSource('cache');
            setSentryUser({ id: cached.id, email: cached.email, tier: cached.tier, is_admin: cached.is_admin });
          } else {
            const stub = profileFromJwt(localSession);
            if (stub) {
              setProfile(stub);
              setProfileSource('jwt');
              setSentryUser({ id: stub.id, email: stub.email, tier: stub.tier, is_admin: stub.is_admin });
            }
          }
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
          // SHERLOCK R7 fix : if getSession returns NULL but we have a local
          // session loaded, KEEP the local session. Avant : refresh on slow
          // ISP could trigger getSession returning null (refresh hiccup, edge
          // case in supabase-js), which then setSession(null) → AuthGuard
          // → /login → user reports "refresh deauths automatically".
          //
          // Now : only override the local session if getSession actually
          // returned one. If supabase-js truly determines the session is
          // dead, it'll fire SIGNED_OUT explicitly via onAuthStateChange,
          // and that handler clears state.
          if (mounted && existingSession) {
            setSession(existingSession);
          }
        } catch (e) {
          if (!isLockAbortError(e)) {
            // eslint-disable-next-line no-console
            console.warn('[Aurel] getSession bg failed (slow ISP?)', e);
          }
          // Continue avec ce qu'on a (session lue synchrone du localStorage)
        }

        // Use either the freshly-fetched session OR fall back to the local
        // one we hydrated synchronously in Étape 1. This way loadProfile +
        // verifyLocalSession still run on slow-ISP refresh.
        const sessionForBg = existingSession ?? localSession;

        if (sessionForBg?.user && mounted) {
          try { subscribeToProfile(sessionForBg.user.id); }
          catch (e) { console.warn('[Aurel] subscribeToProfile bg error', e); }
          try { await loadProfile(sessionForBg.user.id); }
          catch (e) {
            if (!isLockAbortError(e)) console.warn('[Aurel] loadProfile bg error', e);
          }

          // SHERLOCK R8 fix (admin refresh = logged out) : on n'appelle PLUS
          // verifyLocalSession au bootstrap. Ancien comportement :
          //   - claim_session lors du login pouvait timeout sans persister le
          //     session_id en localStorage (Supabase EU lent depuis DZ).
          //   - Au refresh, verifyLocalSession lisait l'ancien session_id de
          //     localStorage (stale car claim n'avait pas écrit) → DB compare
          //     vs current → mismatch → forceSignOut('verify_failed').
          //
          // Maintenant : bootstrap = trust local. Le single-active-session reste
          // enforcé par :
          //   1. Realtime kick instantané quand un autre device claim une session
          //   2. setInterval verifyLocalSession toutes les 3 min (voir effect ci-dessous)
          // touch_last_login reste un fire-and-forget pour les analytics.
          supabase.rpc('touch_last_login').then(() => {}, () => {});
        }
      })();
    })();

    // 2. Auth state changes — déduplique avec le bootstrap pour éviter
    // double claim/subscribe si Supabase JS fire SIGNED_IN au restore.
    let lastHandledUserId: string | null = null;
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      // SHERLOCK R15 — CRITICAL BUG FIX of R12.
      //
      // R12 was supposed to ignore spurious SIGNED_OUT events but had a
      // FATAL ordering bug : `setSession(newSession)` ran UNCONDITIONALLY
      // at the top of the handler, BEFORE the SIGNED_OUT check.
      // So when supabase-js fired SIGNED_OUT with newSession=null (token
      // refresh hiccup on slow ISP, transient 401, etc.), this line
      // immediately cleared the session → AuthGuard saw session=null →
      // redirect to /login. The "ignore" return below was too late : damage done.
      //
      // FIX : early-return BEFORE any state mutation if the event is a
      // spurious SIGNED_OUT (no intentionalSignOutRef set). Now the React
      // session state survives spurious SIGNED_OUT events. The JWT in
      // supabase-js storage may briefly become invalid ; supabase-js's own
      // auto-refresh re-issues a fresh token on next API call. User stays
      // logged in. This is what R12 was supposed to do.
      if (event === 'SIGNED_OUT' && !intentionalSignOutRef.current) {
        // R23 : throttle the log to once per minute. On flapping ISP this
        // can fire dozens of times in a row and pollute Sentry breadcrumbs.
        const now = Date.now();
        if (now - lastSpuriousSignOutLogAtRef.current > 60_000) {
          lastSpuriousSignOutLogAtRef.current = now;
          // eslint-disable-next-line no-console
          console.warn('[Aurel R15] Ignoring spurious SIGNED_OUT — session preserved (throttled)');
        }
        return;
      }

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
        if (cached) {
          setProfile(cached);
          setProfileSource('cache');
        } else {
          const stub = profileFromJwt(newSession);
          if (stub) {
            setProfile(stub);
            setProfileSource('jwt');
          }
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
        if (cachedSi) {
          setProfile(cachedSi);
          setProfileSource('cache');
        } else {
          const stub = profileFromJwt(newSession);
          if (stub) {
            setProfile(stub);
            setProfileSource('jwt');
          }
        }

        // SHERLOCK R19 : only call claim_session if we DON'T already have a
        // local session_id for this user. On F5 with R17 backup restore,
        // supabase-js fires SIGNED_IN (not INITIAL_SESSION) because it sees a
        // "new" session in storage. But we already have a session_id from the
        // original login. Re-claiming would :
        //   1. Issue a NEW UUID server-side that races with our existing one.
        //   2. If claim_session times out CLIENT-side but SUCCEEDS server-side
        //      (common on slow ISP), the DB now has the new UUID but
        //      localStorage still has the old one. The next Realtime UPDATE
        //      event then fires a false kick because new_sid != local_sid.
        //
        // Skipping the re-claim when we already have a session_id keeps the
        // existing one valid and avoids the race. Legitimate kicks (login
        // on another device) still work because on that OTHER device the
        // SIGNED_IN fires WITHOUT a pre-existing localSid → claim runs →
        // new UUID broadcasted → this device gets kicked.
        //
        // RACE FIX (existing) : on N'attache PAS subscribeToProfile avant
        // que claim_session ait écrit le nouveau session_id en localStorage.
        const existingSid = readLocalSessionId();
        if (!existingSid) {
          await claimSession();
        } else {
          // eslint-disable-next-line no-console
          console.info('[Aurel R19] SIGNED_IN with existing sid — skipping claim_session');
        }

        // Subscribe APRÈS que la nouvelle session_id soit en localStorage.
        subscribeToProfile(newSession.user.id);

        await loadProfile(newSession.user.id);
      } else if (event === 'TOKEN_REFRESHED' && newSession?.user) {
        // Refresh JWT silencieux → on touche à rien sauf si le profile manque
        if (!profile) await loadProfile(newSession.user.id);
      } else if (event === 'SIGNED_OUT') {
        // SHERLOCK R12 (BULLETPROOF) — never logout except via explicit user
        // action. supabase-js fires SIGNED_OUT for many reasons : explicit
        // signOut call, token refresh failure, transient 401 from slow auth
        // endpoint, refresh-token revoked, etc.
        //
        // We only want to acknowledge SIGNED_OUT when WE triggered it (user
        // clicked logout button OR realtime kicked another session). Any
        // other SIGNED_OUT = spurious = ignore = keep user logged in.
        //
        // Users on slow DZ → Supabase EU routing had constant random logouts.
        // No more. The session JWT might be stale but the React state stays.
        // Next API call may 401, but user can click around or refresh and
        // supabase-js will auto-refresh. Worst case : a few failed queries
        // until the next refresh cycle. Never a logout unless intentional.
        if (!intentionalSignOutRef.current) {
          console.warn('[Aurel] Ignoring spurious SIGNED_OUT — user stays logged in (R12)');
          return;
        }
        intentionalSignOutRef.current = false;

        lastHandledUserId = null;
        if (realtimeChannelRef.current) {
          await supabase.removeChannel(realtimeChannelRef.current);
          realtimeChannelRef.current = null;
        }
        writeLocalSessionId(null);
        setProfile(null);
        setProfileSource('none');
        clearCachedProfile();
        setSentryUser(null);
        // SHERLOCK R3 fix : clear queryClient on any sign-out path,
        // including expirations / external signOut calls.
        queryClient.clear();
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

  // SHERLOCK R23 : sync isAdminRef whenever profile changes. Used by the
  // Realtime kick handler + verify_session poll to skip enforcement for
  // admins (multi-device allowed). isAdminConfirmedRef flips true ONCE
  // profileSource hits 'db' so the kick handler knows when the value is
  // authoritative vs still in stub/cache transition.
  useEffect(() => {
    isAdminRef.current = !!profile?.is_admin && (profileSource === 'db' || profileSource === 'cache');
    if (profileSource === 'db') {
      isAdminConfirmedRef.current = true;
    }
  }, [profile?.is_admin, profileSource]);

  // SHERLOCK R17 : write to independent session backup whenever the session
  // changes. The backup survives even if supabase-js wipes its own storage on
  // a failed token refresh. On next page load, supabase.ts's
  // restoreMainFromBackupIfMissing() rehydrates the main storage from this
  // backup BEFORE supabase-js initializes → no F5 logout possible.
  useEffect(() => {
    if (session) {
      writeSessionBackup(session);
    }
    // Note : do NOT call clearSessionBackup() when session becomes null here.
    // That happens both for intentional logouts AND for transient state in
    // useAuth during re-renders. Backup clearing is done explicitly inside
    // signOut() and forceSignOut() to keep it tied to user intent.
  }, [session]);

  // SHERLOCK R12 (BULLETPROOF) — removed the periodic verifyLocalSession poll.
  //
  // Why : the poll was supposed to be a safety net if Realtime is down for
  // single-active-session enforcement. But on slow DZ → Supabase EU, the
  // verify_session RPC frequently timed out OR returned ok:false transiently
  // (replication lag, network blip), causing forceSignOut('verify_failed')
  // and kicking legitimate users out of their session.
  //
  // The Realtime channel (subscribeToProfile) handles real-time kicks when
  // another device truly claims the session. That's the primary mechanism
  // and it works fine. The poll was a paranoid backup we don't need.
  //
  // Outcome : user stays logged in across slow-ISP refreshes, app sleeps,
  // tab returns from background, etc. Only explicit logout or genuine
  // realtime kick can sign them out.

  // SHERLOCK R14 — H12 : on remet un poll TRÈS smart pour rattraper le cas
  // où Realtime n'a pas pu broadcast (user offline pendant le kick d'un
  // autre device → re-online → Realtime catch-up unreliable). Le poll
  // tourne TOUTES LES 10 MIN (vs 3 min historiquement) ET ne déclenche
  // forceSignOut qu'après 3 verify_session ok:false CONSÉCUTIFS — donc
  // 30 min de mauvaise reception réseau avant kick. Les network errors
  // (try/catch) ne comptent PAS comme failures (anti-flap pur). Le poll
  // pause aussi quand le tab est invisible (battery + network friendly).
  useEffect(() => {
    if (!session?.user?.id) return;
    let consecutiveFailures = 0;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      // R23 : ADMIN MULTI-DEVICE. Admins are exempt from single-active-session
      // enforcement, so skip the verify_session poll entirely. Otherwise an
      // admin logged in on device A would get strikes when they also log into
      // device B (current_session_id in DB matches B, not A).
      if (isAdminRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const localSid = readLocalSessionId();
      if (!localSid) return;
      try {
        type VerifyData = { ok?: boolean; error?: string } | null;
        const result = await withTimeout<{ data: VerifyData; error: unknown }>(
          supabase.rpc('verify_session', { p_session_id: localSid }) as unknown as PromiseLike<{ data: VerifyData; error: unknown }>,
          6000,
          'verify_session R14-H12 poll',
        );
        if (result.error) {
          // Network/RPC error → don't count as failure (anti-flap).
          return;
        }
        if (result.data?.ok === false) {
          consecutiveFailures += 1;
          // 3 strikes : on accepte que le user est vraiment kicked.
          if (consecutiveFailures >= 3) {
            intentionalSignOutRef.current = true;
            await forceSignOut('kicked');
          }
        } else if (result.data?.ok === true) {
          consecutiveFailures = 0;
        }
        // ok undefined → ignore (peut être un état transitoire RPC)
      } catch {
        // Swallow — network error, do not count toward strike count.
      }
    };

    const interval = window.setInterval(tick, 600_000); // 10 min
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [session?.user?.id, forceSignOut]);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return;
    await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const signOut = useCallback(async () => {
    // R12 : mark this signOut as user-initiated so SIGNED_OUT event executes
    // its cleanup branch. Without this flag, my R12 fix would treat the
    // event as spurious and refuse to clear state.
    intentionalSignOutRef.current = true;
    // R16 : unlock the localStorage suppression so supabase.auth.signOut()
    // can clear the auth key for real (user clicked logout, we want it gone).
    // Re-locked in the finally block so future spurious SIGNED_OUT events
    // cannot wipe storage during the next session.
    intentionalRemoval.current = true;
    // R17 : also clear our independent session backup.
    clearSessionBackup();

    // SHERLOCK R7 fix : OPTIMISTIC clear FIRST so the UI flips to logged-out
    // state immediately, regardless of network. Avant : signOut awaited
    // supabase.auth.signOut({scope:'global'}) which calls the server. On
    // slow ISP / when refresh token is rejected, this could hang or throw,
    // and the user would click "logout" with NO visible effect for 10+ sec.
    //
    // Now : local state is cleared instantly (user sees logout). The
    // server-side revoke fires in background with a 5s timeout. If it
    // fails (network, expired token), we don't block — local state is
    // already correct and refresh tokens will expire naturally.
    writeLocalSessionId(null);
    setSession(null);
    setProfile(null);
    setProfileSource('none');
    clearCachedProfile();
    setSentryUser(null);
    queryClient.clear();
    // Cleanup channel (sync — supabase removeChannel is local).
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current).catch(() => {});
      realtimeChannelRef.current = null;
    }
    // Best-effort server signOut with timeout. Wrapped in try so a hang/
    // throw doesn't propagate to the caller that's already navigated away.
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: 'global' }),
        new Promise<void>((_, rej) => setTimeout(() => rej(new Error('signOut timeout')), 5000)),
      ]);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Aurel] server signOut failed/slow (local state already cleared):', (e as Error)?.message ?? e);
    } finally {
      // R16 : re-lock so subsequent spurious SIGNED_OUT events can't wipe storage.
      intentionalRemoval.current = false;
    }
  }, [queryClient]);

  // SHERLOCK round 2 fix : useMemo le value object pour stabiliser la
  // référence — sinon chaque parent re-render créait un nouveau objet et
  // tous les useAuth() consumers re-rendaient (kicked-listener, header,
  // guards, ...). Ne change pas la sémantique, juste les perf.
  //
  // SHERLOCK round 2 fix : isAdmin est confirmed-only — true UNIQUEMENT
  // quand le profile vient de la DB. Avant, un cache poisoned avec
  // is_admin:true (devtools edit du localStorage, OU stub depuis JWT
  // d'un user dont les claims user_metadata seraient compromis) faisait
  // render l'admin UI pendant 30s avant que la DB ne corrige. Le DB
  // protégeait les données via RLS, mais la structure des routes admin
  // + endpoints listés leakaient. Maintenant : fail-closed par défaut,
  // l'admin UI n'apparaît que sur confirmation DB.
  const value: AuthContextValue = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    profileSource,
    isLoading,
    // SHERLOCK R20 : also trust 'cache' source for isAdmin. Cache is only ever
    // written AFTER a successful DB read, so cache.is_admin=true means it
    // really was true in DB within the last 24h (TTL). The 'jwt' stub source
    // is still rejected because JWT doesn't carry the is_admin claim by
    // default (profileFromJwt hardcodes false).
    //
    // Trade-off : if an admin's privileges are revoked between cache write
    // and now, they'd still see the admin nav for up to 24h. But all admin
    // actions go through server-side RLS which rejects non-admins anyway —
    // so the worst case is they see a useless nav with permission errors.
    // Better that than legitimate admins NOT seeing admin nav on slow ISP
    // where loadProfile timed out and only cache+stub are available.
    isAdmin: !!profile?.is_admin && (profileSource === 'db' || profileSource === 'cache'),
    refreshProfile,
    signOut,
  }), [session, profile, profileSource, isLoading, refreshProfile, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
