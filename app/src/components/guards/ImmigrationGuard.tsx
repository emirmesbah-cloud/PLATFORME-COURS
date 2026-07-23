import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';

/**
 * ImmigrationGuard — gates the /immigration/* routes.
 * Access granted to :
 *   - admins (always — preview / support)
 *   - students whose profile.course_access === 'immigration'
 * Everyone else is redirected to their own space (/dashboard).
 *
 * Mirrors AdminGuard's stub handling : the JWT-stub profile has NO course_access,
 * so deciding on it would wrongly bounce a legit Immigration student on a new
 * device / slow ISP (first load, before cache/DB resolves). We wait briefly for
 * the profile to upgrade to 'cache'/'db' (which carry course_access) before
 * deciding; after 5s of only-stub we fall back to /dashboard (fail-closed).
 */
export function ImmigrationGuard({ children }: { children: React.ReactNode }) {
  const { session, profile, profileSource, isLoading, isAdmin } = useAuth();

  // Brief wait for a JWT-stub profile to upgrade to cache/DB (which carries
  // course_access). Same 5s fail-closed pattern as AdminGuard.
  const [stubExpired, setStubExpired] = useState(false);
  useEffect(() => {
    if (session && profile && profileSource === 'jwt') {
      setStubExpired(false);
      const t = setTimeout(() => setStubExpired(true), 5000);
      return () => clearTimeout(t);
    }
    setStubExpired(false);
  }, [session?.user?.id, profile?.id, profileSource]);

  if (isLoading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace />;

  if (!profile) {
    return <FullPageSpinner label="Vérification de l'accès…" />;
  }

  // Only the JWT stub so far (no course_access on it) — wait for cache/DB rather
  // than bouncing a real Immigration student. After 5s, fail closed.
  if (profileSource === 'jwt') {
    if (!stubExpired) {
      return <FullPageSpinner label="Vérification de l'accès…" />;
    }
    return <Navigate to="/dashboard" replace />;
  }

  // profile is from 'cache' or 'db' → course_access is trustworthy.
  const allowed = isAdmin || profile.course_access === 'immigration';
  if (!allowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
