import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';

export function RootRedirect() {
  const { session, profile, isLoading, isAdmin } = useAuth();

  // RACE FIX (port from Naim) : si session présente mais profile pas encore
  // chargé, on attend 5s avant de router. Sinon : un admin qui arrive sur "/"
  // se ferait router vers /dashboard (par défaut isAdmin=false dans le stub
  // JWT) avant même que le profile DB n'arrive avec le vrai is_admin → re-
  // direction inutile + flash UI désagréable.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (session && !profile) {
      setWaited(false);
      const t = setTimeout(() => setWaited(true), 5000);
      return () => clearTimeout(t);
    }
    setWaited(false);
  }, [session?.user?.id, profile?.id]);

  if (isLoading) return <FullPageSpinner />;
  if (!session)  return <Navigate to="/login" replace />;
  if (!profile && !waited) return <FullPageSpinner label="Chargement du profil…" />;

  // Admins atterrissent sur /admin. Ils peuvent basculer sur l'espace étudiant
  // via le lien "Espace étudiant" dans le header admin.
  return <Navigate to={isAdmin ? '/admin' : '/dashboard'} replace />;
}
