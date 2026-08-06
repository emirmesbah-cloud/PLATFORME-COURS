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
 * device / slow ISP (first load, before cache/DB resolves). A cached Pflege
 * value can also be stale immediately after an admin grants Immigration.
 * We therefore wait for the authoritative DB profile before denying access.
 */
export function ImmigrationGuard({ children }: { children: React.ReactNode }) {
  const { session, profile, profileSource, isLoading, isAdmin } = useAuth();

  // loadProfile can take 12s × 3 attempts on a very slow connection. The old
  // 5s timeout rejected legitimate Immigration students before attempt 1 had
  // even completed.
  const [profileWaitExpired, setProfileWaitExpired] = useState(false);
  useEffect(() => {
    const needsAuthoritativeCheck = session && profile && (
      profileSource === 'jwt' ||
      (profileSource === 'cache' && profile.course_access !== 'immigration')
    );
    if (needsAuthoritativeCheck) {
      setProfileWaitExpired(false);
      const t = setTimeout(() => setProfileWaitExpired(true), 45_000);
      return () => clearTimeout(t);
    }
    setProfileWaitExpired(false);
  }, [session?.user?.id, profile?.id, profile?.course_access, profileSource]);

  if (isLoading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace />;

  if (!profile) {
    return <FullPageSpinner label="Vérification de l'accès…" />;
  }

  // Wait on a JWT stub or a potentially stale denying cache. A DB-confirmed
  // profile remains the authorization source; after 45s we still fail closed.
  if (
    profileSource === 'jwt' ||
    (profileSource === 'cache' && profile.course_access !== 'immigration')
  ) {
    if (!profileWaitExpired) {
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
