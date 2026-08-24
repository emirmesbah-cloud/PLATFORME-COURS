import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { closerLandingPath } from '@/components/layout/StudentLayout';

export function RootRedirect() {
  const { session, profile, profileSource, isLoading, isAdmin } = useAuth();

  // SHERLOCK round 2 fix : on attend la CONFIRMATION DB avant de router
  // pour les admins. Avant, un admin avec stub JWT (is_admin: false par
  // défaut) ou cache fraîchement vide se faisait router vers /dashboard
  // pendant les 30s du loadProfile, puis re-router vers /admin quand le
  // DB confirmait — flash UI désagréable.
  //
  // Maintenant : si le profile n'est pas encore DB-confirmed, on attend
  // jusqu'à 45s. Au-delà, fallback /dashboard (le RootRedirect n'a pas
  // accès à des routes protégées, donc l'admin sera juste sur /dashboard
  // brièvement avant que la DB n'arrive et qu'il navigue lui-même).
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const needsWait = session && (!profile || profileSource !== 'db');
    if (needsWait) {
      // SHERLOCK R3 fix : ne re-set PAS waited=false ici. Une fois le
      // timeout écoulé, on reste en mode "go ahead with what we have"
      // jusqu'au prochain user.id change. Sinon, profile arrives → waited
      // flip false → spinner re-flicker → DB confirms → final route.
      // loadProfile may legitimately need 12s × 3 retries on a poor mobile
      // connection. Five seconds routed Immigration students into Pflege
      // before the first authoritative request had completed.
      const t = setTimeout(() => setWaited(true), 45_000);
      return () => clearTimeout(t);
    }
    // Pas de needsWait → pas besoin de timer. On reset waited à false
    // SEULEMENT au logout (session=null) — sinon on garde l'état stable.
    if (!session) setWaited(false);
  }, [session?.user?.id, profile?.id, profileSource]);

  if (isLoading) return <FullPageSpinner />;
  if (!session)  return <Navigate to="/login" replace />;

  // Profile pas DB-confirmé yet → spinner jusqu'à 45s pour laisser le
  // loadProfile background rapatrier la vérité. Évite le flash d'admin
  // routé vers /dashboard.
  if ((!profile || profileSource !== 'db') && !waited) {
    return <FullPageSpinner label="Chargement du profil…" />;
  }

  // Admins atterrissent sur /admin. Ils peuvent basculer sur l'espace étudiant
  // via le lien "Espace étudiant" dans le header admin.
  if (isAdmin) return <Navigate to="/admin" replace />;

  // Closers land straight on their attributed section (Prospects) — they have a
  // scoped, prospects-only admin space, not the student course.
  if (profile?.staff_role === 'closer' && (profile?.staff_permissions?.length ?? 0) > 0) {
    return <Navigate to={closerLandingPath(profile.staff_permissions)} replace />;
  }

  // Single-course routing : un étudiant Immigration atterrit sur son cours,
  // un étudiant Pflege (défaut) sur le dashboard Pflege existant.
  if (profile?.course_access === 'immigration') {
    return <Navigate to="/immigration" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}
