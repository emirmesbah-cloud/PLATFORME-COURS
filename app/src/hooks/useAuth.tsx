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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Refs pour éviter les fuites mémoire et garder la valeur stable dans les callbacks
  const realtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const isSigningOutRef = useRef(false);

  /**
   * Charge le profile avec retry + auto-recovery.
   * Si après 2 tentatives on a une session valide mais aucun profile (cas
   * pathologique : RLS cassée en prod, JWT expiré, profil supprimé), on
   * force un signOut pour casser la boucle "/activate → /dashboard → /activate".
   */
  const loadProfile = useCallback(async (userId: string): Promise<void> => {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (!error) {
        const profile = data as Profile | null;
        setProfile(profile);
        setSentryUser(profile ? {
          id: profile.id, email: profile.email,
          tier: profile.tier, is_admin: profile.is_admin,
        } : null);
        return;
      }

      lastError = error;
      // eslint-disable-next-line no-console
      console.warn(`[Aurel] loadProfile attempt ${attempt} failed`, error);
      if (attempt === 1) await new Promise(r => setTimeout(r, 500));
    }

    // 2 échecs consécutifs → on auto-recovery en signant l'utilisateur out
    // pour casser tout état pathologique côté frontend
    // eslint-disable-next-line no-console
    console.error('[Aurel] loadProfile failed twice, forcing signOut to recover', lastError);
    setProfile(null);
    setSentryUser(null);
    try {
      writeLocalSessionId(null);
      await supabase.auth.signOut();
    } catch {}
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
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);

        if (reason === 'kicked') {
          // Émet un event global → un Toast peut l'écouter ailleurs si besoin.
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
   */
  const subscribeToProfile = useCallback(
    (userId: string) => {
      // Nettoie une éventuelle subscription précédente
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
            const newSid = (payload.new as { current_session_id?: string | null })
              ?.current_session_id;
            const localSid = readLocalSessionId();
            if (!newSid) return;
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
   * Appelé après chaque LOGIN ou ACTIVATION (pas sur token refresh).
   */
  const claimSession = useCallback(async () => {
    const { data, error } = await supabase.rpc('claim_session');
    if (error || !data?.ok) {
      // eslint-disable-next-line no-console
      console.warn('[Aurel] claim_session failed', error || data);
      return;
    }
    if (data.session_id) writeLocalSessionId(data.session_id);
  }, []);

  /**
   * Verify la session locale contre la DB. Appelé au boot avec un JWT existant.
   * Si mismatch → logout forcé.
   */
  const verifyLocalSession = useCallback(async () => {
    const localSid = readLocalSessionId();
    if (!localSid) {
      // Pas de session_id local → on en claim un nouveau (legacy ou cleared).
      await claimSession();
      return;
    }
    const { data, error } = await supabase.rpc('verify_session', {
      p_session_id: localSid,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[Aurel] verify_session error', error);
      return; // tolérant : pas de logout sur erreur RPC réseau
    }
    if (!data?.ok) {
      await forceSignOut('verify_failed');
    }
  }, [claimSession, forceSignOut]);

  useEffect(() => {
    let mounted = true;

    // 1. Bootstrap : check la session existante
    supabase.auth.getSession().then(async ({ data: { session: existingSession } }) => {
      if (!mounted) return;
      setSession(existingSession);
      if (existingSession?.user) {
        await loadProfile(existingSession.user.id);
        await verifyLocalSession();
        subscribeToProfile(existingSession.user.id);
        // Touch last_login (best-effort)
        supabase.rpc('touch_last_login').then(() => {});
      }
      setIsLoading(false);
    });

    // 2. Auth state changes
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession);

      if (event === 'SIGNED_IN' && newSession?.user) {
        // Vrai login (pas un refresh) → claim une nouvelle session
        await loadProfile(newSession.user.id);
        await claimSession();
        subscribeToProfile(newSession.user.id);
      } else if (event === 'TOKEN_REFRESHED' && newSession?.user) {
        // Refresh JWT silencieux → on touche à rien
        if (!profile) await loadProfile(newSession.user.id);
      } else if (event === 'SIGNED_OUT') {
        if (realtimeChannelRef.current) {
          await supabase.removeChannel(realtimeChannelRef.current);
          realtimeChannelRef.current = null;
        }
        writeLocalSessionId(null);
        setProfile(null);
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
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
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
