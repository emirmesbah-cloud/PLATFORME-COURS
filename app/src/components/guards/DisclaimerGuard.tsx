import { Navigate, useLocation } from 'react-router-dom';
import { type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';

/**
 * DisclaimerGuard — wraps student routes after AuthGuard.
 * Redirects to /disclaimer if profile.disclaimer_acknowledged_at IS NULL.
 *
 * Admins are exempt (migration 20260520000027 auto-acked them at deploy time).
 * If an admin somehow doesn't have the timestamp, profile.is_admin still
 * passes them through — admins have their own gates elsewhere.
 *
 * Belt-and-suspenders : the server's update_lesson_progress() also rejects
 * writes from un-ack'd users. Even if a client bypasses this React guard,
 * no lesson progress can be saved.
 */
export function DisclaimerGuard({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const location = useLocation();

  // AuthGuard already gated on `profile` existing. If we somehow get here
  // without one, pass through and let the next layer handle it.
  if (!profile) return <>{children}</>;

  // Admins always exempt.
  if (profile.is_admin) return <>{children}</>;

  // Already acknowledged → continue.
  if (profile.disclaimer_acknowledged_at) return <>{children}</>;

  // Not yet acknowledged → redirect. Preserve attempted path for a
  // post-ack redirect (currently DisclaimerPage navigates to /dashboard,
  // but the `state.from` is here for future use).
  return <Navigate to="/disclaimer" state={{ from: location }} replace />;
}
