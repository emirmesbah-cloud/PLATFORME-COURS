import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';

export function RootRedirect() {
  const { session, isLoading } = useAuth();
  if (isLoading) return <FullPageSpinner />;
  return <Navigate to={session ? '/dashboard' : '/login'} replace />;
}
