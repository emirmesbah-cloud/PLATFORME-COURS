import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Lock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { jwtIsRecoverySession } from '@/lib/jwt';
import { useToast } from '@/components/ui/Toast';
import { AurelLogo } from '@/components/features/AurelLogo';

/**
 * /reset-password
 *
 * Landing page that the Supabase password-recovery email links to.
 * Supabase JS auto-detects the recovery hash on mount and emits a
 * PASSWORD_RECOVERY auth event. We then let the user pick a new password
 * via supabase.auth.updateUser({ password }).
 *
 * SECURITY (Sherlock fix) :
 *   Avant ce fix, la page autorisait un changement de mdp dès qu'une session
 *   existait — n'importe quel onglet déjà loggué naviguant vers /reset-password
 *   pouvait silencieusement changer le mdp du user sans re-auth. Maintenant
 *   on exige un PASSWORD_RECOVERY event OU un JWT avec `amr` claim contenant
 *   `recovery` — c'est la seule façon d'arriver ici via le mail de reset.
 *
 *   Le check `amr` survit au reload de la page (même si l'event PASSWORD_RECOVERY
 *   a déjà été consommé avant que le composant ne soit monté).
 */

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [ready, setReady]         = useState(false);
  const [linkValid, setLinkValid] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]           = useState(false);

  const [pwd, setPwd]         = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    let mounted = true;
    let recoveryEventSeen = false;

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') {
        recoveryEventSeen = true;
        setLinkValid(true);
        setReady(true);
      }
      // SIGNED_IN avec un JWT recovery (cas reload après l'event a été consommé)
      if (event === 'SIGNED_IN' && session && jwtIsRecoverySession(session.access_token)) {
        setLinkValid(true);
        setReady(true);
      }
    });

    // Safety net : check getSession après un court délai. Si le user a une
    // session AVEC amr=recovery → valid. Sinon, on refuse, MÊME si une
    // session normale existe (l'ancien comportement laissait passer
    // n'importe quelle session active = vulnérable).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      // Petite grace period au cas où PASSWORD_RECOVERY arrive juste après.
      setTimeout(() => {
        if (!mounted) return;
        if (recoveryEventSeen) return; // déjà géré
        if (session && jwtIsRecoverySession(session.access_token)) {
          setLinkValid(true);
        }
        setReady(true);
      }, 500);
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pwd.length < 8) {
      toast.error('Mot de passe trop faible (min. 8 caractères).', 'Erreur');
      return;
    }
    if (pwd !== confirm) {
      toast.error('Les mots de passe ne correspondent pas.', 'Erreur');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setSubmitting(false);
    if (error) {
      toast.error(error.message, 'Erreur');
      return;
    }
    setDone(true);
    toast.success('Mot de passe mis à jour.', 'Succès');
    // scope:'global' pour révoquer le refresh token côté serveur — empêche
    // un attaquant qui aurait un refresh token volé de rester connecté.
    await supabase.auth.signOut({ scope: 'global' });
    // SHERLOCK R3 fix : `done` flag déclenche un redirect via useEffect
    // (cf. ci-dessous) plutôt qu'un setTimeout direct ici. Ça évite que
    // le navigate fire APRÈS un démontage si l'user back-button rapide.
  }

  // Redirect 2s après le done : useEffect garantit clearTimeout au unmount.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigate('/login', { replace: true }), 2000);
    return () => clearTimeout(t);
  }, [done, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><AurelLogo size="lg" /></div>
        <div className="card-padded">
          {!ready ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-aurel-orange" />
            </div>
          ) : !linkValid ? (
            <div className="text-center">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-500" />
              <h1 className="mb-2 text-xl font-bold text-aurel-ink">Lien invalide ou expiré</h1>
              <p className="mb-6 text-sm text-slate-600">
                Ce lien de réinitialisation n'est plus valide, ou tu n'es pas arrivé·e ici via un mail de reset. Demande un nouveau lien depuis la page de connexion.
              </p>
              <Link to="/forgot-password" className="btn-primary btn-block">
                Demander un nouveau lien
              </Link>
            </div>
          ) : done ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
              <h1 className="mb-2 text-xl font-bold text-aurel-ink">Mot de passe mis à jour</h1>
              <p className="mb-6 text-sm text-slate-600">Redirection vers la connexion…</p>
            </div>
          ) : (
            <>
              <h1 className="mb-1 text-2xl font-bold text-aurel-ink">Nouveau mot de passe</h1>
              <p className="mb-6 text-sm text-slate-600">
                Choisis un nouveau mot de passe pour ton compte.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label" htmlFor="pwd">Nouveau mot de passe</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="pwd"
                      type="password"
                      autoComplete="new-password"
                      className="input pl-10"
                      placeholder="min. 8 caractères"
                      value={pwd}
                      onChange={(e) => setPwd(e.target.value)}
                      required
                      minLength={8}
                    />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="confirm">Confirmer le mot de passe</label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="confirm"
                      type="password"
                      autoComplete="new-password"
                      className="input pl-10"
                      placeholder="min. 8 caractères"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      minLength={8}
                    />
                  </div>
                </div>
                <button type="submit" disabled={submitting} className="btn-primary btn-lg btn-block">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
