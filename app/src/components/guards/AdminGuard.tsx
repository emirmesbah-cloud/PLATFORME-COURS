import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

export function AdminGuard({ children }: { children: ReactNode }) {
  const { session, profile, profileSource, isLoading, isAdmin } = useAuth();
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

  // SHERLOCK round 2 fix : on attend explicitement la confirmation DB du
  // profile avant de décider admin/non-admin. Avant, le profile était
  // matérialisé immédiatement depuis JWT-stub (`is_admin: false`) ou cache
  // (potentiellement poisoned), ce qui causait :
  //   1. Faux toast "Accès refusé" pour les vrais admins pendant le délai
  //      stub→DB.
  //   2. Cache poisoned (devtools edit localStorage avec is_admin:true)
  //      faisait render l'admin UI pendant 30s avant que la DB ne corrige.
  // Maintenant : on spinner jusqu'à `profileSource === 'db'` (max 30s),
  // puis on tranche sur l'isAdmin confirmé. `isAdmin` du context est
  // déjà DB-gated (voir useAuth → isAdmin = is_admin && profileSource==='db').
  const [dbConfirmExpired, setDbConfirmExpired] = useState(false);
  useEffect(() => {
    if (session && profile && profileSource !== 'db') {
      setDbConfirmExpired(false);
      const t = setTimeout(() => setDbConfirmExpired(true), 30000);
      return () => clearTimeout(t);
    }
    setDbConfirmExpired(false);
  }, [session?.user?.id, profile?.id, profileSource]);

  useEffect(() => {
    // Fire la toast UNIQUEMENT après la confirmation DB — sinon les vrais
    // admins voient un faux "Accès refusé" pendant la transition stub→DB.
    if (!isLoading && session && profile && profileSource === 'db' && !isAdmin) {
      toast.error('Accès refusé. Cet espace est réservé aux administrateurs.', 'Accès refusé');
    }
  }, [isLoading, session, profile, profileSource, isAdmin, toast]);

  if (isLoading) return <FullPageSpinner label="Chargement…" />;
  if (!session)  return <Navigate to="/login" replace />;
  if (!profile) {
    if (!profileLoadingExpired) {
      return <FullPageSpinner label="Chargement du profil…" />;
    }
    return <Navigate to="/login" state={{ profileLoadFailed: true, from: location }} replace />;
  }

  // Profile présent mais pas encore DB-confirmé → spinner jusqu'à 30s.
  // Sur ISP lent, on évite à la fois le faux toast ET l'admin UI flash.
  if (profileSource !== 'db') {
    if (!dbConfirmExpired) {
      return <FullPageSpinner label="Vérification des droits d'accès…" />;
    }
    // 30s sans confirmation DB → on assume que la query échoue durablement.
    // Fallback /dashboard (sécurité = on n'autorise PAS l'admin UI sans
    // confirmation, on dégrade gracieusement vers l'espace student).
    return <Navigate to="/dashboard" replace />;
  }

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}
