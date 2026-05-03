import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

export function AdminGuard({ children }: { children: ReactNode }) {
  const { session, profile, isLoading, isAdmin } = useAuth();
  const toast = useToast();
  const location = useLocation();

  // Same race-fix tolerance as AuthGuard : pendant ~1-2 sec post-login,
  // session existe mais profile=null. Sur ISP lent ça peut durer plus
  // longtemps. 30s timeout puis fallback /login (jamais /activate, le
  // user est déjà inscrit).
  const [profileLoadingExpired, setProfileLoadingExpired] = useState(false);
  useEffect(() => {
    if (session && !profile) {
      setProfileLoadingExpired(false);
      const t = setTimeout(() => setProfileLoadingExpired(true), 30000);
      return () => clearTimeout(t);
    }
    setProfileLoadingExpired(false);
  }, [session?.user?.id, profile?.id]);

  useEffect(() => {
    if (!isLoading && session && profile && !isAdmin) {
      toast.error('Accès refusé. Cet espace est réservé aux administrateurs.', 'Accès refusé');
    }
  }, [isLoading, session, profile, isAdmin, toast]);

  if (isLoading) return <FullPageSpinner label="Chargement…" />;
  if (!session)  return <Navigate to="/login" replace />;
  if (!profile) {
    if (!profileLoadingExpired) {
      return <FullPageSpinner label="Chargement du profil…" />;
    }
    return <Navigate to="/login" state={{ profileLoadFailed: true, from: location }} replace />;
  }
  if (!isAdmin)  return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
