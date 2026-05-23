import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

export function AdminGuard({ children }: { children: ReactNode }) {
  const { session, profile, profileSource, isLoading, isAdmin } = useAuth();
  const toast = useToast();
  const location = useLocation();

  // Same race-fix tolerance as AuthGuard : pendant ~1-2 sec post-login,
  // session existe mais profile=null. Sur ISP lent ça peut durer plus
  // longtemps. 60s timeout (was 30s) puis fallback /login.
  const [profileLoadingExpired, setProfileLoadingExpired] = useState(false);
  useEffect(() => {
    if (session && !profile) {
      setProfileLoadingExpired(false);
      const t = setTimeout(() => setProfileLoadingExpired(true), 60000);
      return () => clearTimeout(t);
    }
    setProfileLoadingExpired(false);
  }, [session?.user?.id, profile?.id]);

  // SHERLOCK R20 + R21 : trust cache for admin access.
  // Before, AdminGuard waited up to 30s for profileSource === 'db' before
  // rendering admin UI. On slow Algerian ISP, this meant admins saw the
  // "Vérification des droits d'accès..." spinner for 30 seconds every time
  // they navigated to /admin. Same root cause as R20 (useAuth.isAdmin).
  //
  // Fix : if profile is loaded from cache AND is_admin=true, render the
  // admin UI immediately. Cache is only written after a successful DB
  // read, so its is_admin field is authoritative. Server-side RLS still
  // rejects any admin action from a non-admin, so even if the cache is
  // stale (admin privileges revoked between cache write and now), the
  // worst case is the user sees admin nav and gets permission errors —
  // never an unauthorized action.
  //
  // We keep a SHORT (5s) wait for jwt/stub source to upgrade to cache/db
  // — this covers the brief moment between bootstrap and the first cache
  // hit. After 5s of stub, fall back to /dashboard.
  const [stubExpired, setStubExpired] = useState(false);
  useEffect(() => {
    if (session && profile && profileSource === 'jwt') {
      setStubExpired(false);
      const t = setTimeout(() => setStubExpired(true), 5000);
      return () => clearTimeout(t);
    }
    setStubExpired(false);
  }, [session?.user?.id, profile?.id, profileSource]);

  useEffect(() => {
    // Fire the "not admin" toast only when we have DB confirmation that
    // user is NOT admin. Otherwise we'd show a false-positive toast during
    // stub→cache transition for legitimate admins.
    if (!isLoading && session && profile && profileSource === 'db' && !isAdmin) {
      toast.error('Accès refusé. Cet espace est réservé aux administrateurs.', 'Accès refusé');
    }
  }, [isLoading, session, profile, profileSource, isAdmin, toast]);

  if (isLoading) return <FullPageSpinner label="Chargement…" />;
  if (!session)  return <Navigate to="/login" replace />;
  if (!profile) {
    if (!profileLoadingExpired) {
      return <FullPageSpinner label="Chargement du profil…" />;
    }
    return <Navigate to="/login" state={{ profileLoadFailed: true, from: location }} replace />;
  }

  // If only JWT-stub is available (no cache, no DB yet), wait briefly for
  // an upgrade. JWT stub hardcodes is_admin=false, so we can't trust it.
  if (profileSource === 'jwt') {
    if (!stubExpired) {
      return <FullPageSpinner label="Vérification des droits d'accès…" />;
    }
    // 5s with only stub = something is really wrong. Fall back to dashboard.
    return <Navigate to="/dashboard" replace />;
  }

  // From here, profile is from 'cache' or 'db'. isAdmin already trusts both
  // (R20). If admin → render. If not admin → redirect to dashboard.
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
