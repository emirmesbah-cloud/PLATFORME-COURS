import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';

export function RootRedirect() {
  const { session, profile, profileSource, isLoading, isAdmin } = useAuth();

  // SHERLOCK round 2 fix : on attend la CONFIRMATION DB avant de router
  // pour les admins. Avant, un admin avec stub JWT (is_admin: false par
  // défaut) ou cache fraîchement vide se faisait router vers /dashboard
  // pendant les 30s du loadProfile, puis re-router vers /admin quand le
  // DB confirmait — flash UI désagréable.
  //
  // Maintenant : si le profile n'est pas encore DB-confirmed, on attend
  // jusqu'à 5s. Au-delà, fallback /dashboard (le RootRedirect n'a pas
  // accès à des routes protégées, donc l'admin sera juste sur /dashboard
  // brièvement avant que la DB n'arrive et qu'il navigue lui-même).
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const needsWait = session && (!profile || profileSource !== 'db');
    if (needsWait) {
      setWaited(false);
      const t = setTimeout(() => setWaited(true), 5000);
      return () => clearTimeout(t);
    }
    setWaited(false);
  }, [session?.user?.id, profile?.id, profileSource]);

  if (isLoading) return <FullPageSpinner />;
  if (!session)  return <Navigate to="/login" replace />;

  // Profile pas DB-confirmé yet → spinner jusqu'à 5s pour laisser le
  // loadProfile background rapatrier la vérité. Évite le flash d'admin
  // routé vers /dashboard.
  if ((!profile || profileSource !== 'db') && !waited) {
    return <FullPageSpinner label="Chargement du profil…" />;
  }

  // Admins atterrissent sur /admin. Ils peuvent basculer sur l'espace étudiant
  // via le lien "Espace étudiant" dans le header admin.
  return <Navigate to={isAdmin ? '/admin' : '/dashboard'} replace />;
}
