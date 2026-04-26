import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';

export function AuthGuard({ children }: { children: ReactNode }) {
  const { session, profile, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullPageSpinner label="Chargement…" />;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  // Si auth mais pas de profile (cas rare : user créé hors flow), force activation
  if (!profile) return <Navigate to="/activate" replace />;

  return <>{children}</>;
}
