import { Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { FullPageSpinner } from '@/components/ui/Spinner';

export function AuthGuard({ children }: { children: ReactNode }) {
  const { session, profile, isLoading } = useAuth();
  const location = useLocation();

  // RACE FIX (port from Naim — student-reported bug : login → bouncé vers
  // /activate alors que le user était déjà inscrit) :
  // Après /activate ou /login, setSession() est synchrone côté supabase-js
  // mais le profile est chargé async dans useAuth.onAuthStateChange. Pendant
  // ces ~1-2 sec, session existe MAIS profile=null.
  //
  // SLOW ISP FIX : timeout 30s. Sur ISP Algérien lent vers Supabase EU,
  // loadProfile peut prendre 12s × 3 attempts = 36s. À 6s on coupait des
  // étudiants légitimes vers /activate. À 30s on couvre 99% des cas.
  //
  // Au-delà de 30s sans profile : on redirige vers /login (PAS /activate)
  // car le user est probablement déjà inscrit (sinon il serait pas arrivé
  // ici avec une session). /login propose un bouton "réessayer" et un
  // contexte plus clair que /activate (qui suggérerait au user qu'il doit
  // re-saisir un code, ce qui n'est pas le cas).
  // SHERLOCK R17 : timeout 60s (was 30s) for ultra-slow Algerian ISPs.
  // loadProfile internally retries 3× with 12s each = 36s worst case ;
  // adding a margin for network blips → 60s covers essentially 100% of
  // real-world cases without flapping students to /login.
  const [profileLoadingExpired, setProfileLoadingExpired] = useState(false);
  useEffect(() => {
    if (session && !profile) {
      setProfileLoadingExpired(false);
      const t = setTimeout(() => setProfileLoadingExpired(true), 60000);
      return () => clearTimeout(t);
    }
    setProfileLoadingExpired(false);
  }, [session?.user?.id, profile?.id]);

  if (isLoading) return <FullPageSpinner label="Chargement…" />;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;

  // Session présente, profile encore en cours de load (async post-SIGNED_IN).
  // Spinner jusqu'à ce que le profile arrive (max 30s sur ISP lent).
  // Au-delà : redirect vers /login avec un état d'erreur (pas /activate
  // car le user est déjà enregistré par définition).
  if (!profile) {
    if (!profileLoadingExpired) {
      return <FullPageSpinner label="Chargement du profil…" />;
    }
    return <Navigate to="/login" state={{ profileLoadFailed: true, from: location }} replace />;
  }

  return <>{children}</>;
}
