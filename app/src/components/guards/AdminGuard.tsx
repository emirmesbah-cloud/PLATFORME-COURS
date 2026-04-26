import { Navigate } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

export function AdminGuard({ children }: { children: ReactNode }) {
  const { session, profile, isLoading, isAdmin } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (!isLoading && session && profile && !isAdmin) {
      toast.error('Accès refusé. Cet espace est réservé aux administrateurs.', 'Accès refusé');
    }
  }, [isLoading, session, profile, isAdmin, toast]);

  if (isLoading) return <FullPageSpinner label="Chargement…" />;
  if (!session)  return <Navigate to="/login" replace />;
  if (!profile)  return <Navigate to="/activate" replace />;
  if (!isAdmin)  return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
