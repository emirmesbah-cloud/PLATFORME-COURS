import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';

/**
 * ImmigrationGuard — gates the /immigration/* routes.
 * Access granted to :
 *   - admins (always — preview / support)
 *   - students whose profile.course_access === 'immigration'
 * Everyone else is redirected to their own space (/dashboard).
 *
 * Mirrors the permissive-during-load behaviour of AdminGuard : we wait for
 * the profile to resolve rather than bouncing the user prematurely.
 */
export function ImmigrationGuard({ children }: { children: React.ReactNode }) {
  const { session, profile, profileSource, isLoading, isAdmin } = useAuth();

  if (isLoading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" replace />;

  // Wait for profile to load before deciding (avoid premature bounce).
  if (!profile && profileSource !== 'db') {
    return <FullPageSpinner label="Vérification de l'accès…" />;
  }

  const allowed = isAdmin || profile?.course_access === 'immigration';
  if (!allowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
