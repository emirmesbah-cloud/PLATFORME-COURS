import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';

export function RootRedirect() {
  const { session, isLoading, isAdmin } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  if (!session)  return <Navigate to="/login" replace />;
  // Admins atterrissent sur /admin. Ils peuvent basculer sur l'espace étudiant
  // via le lien "Espace étudiant" dans le header admin.
  return <Navigate to={isAdmin ? '/admin' : '/dashboard'} replace />;
}
