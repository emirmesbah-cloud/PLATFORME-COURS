import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AurelLogo } from '@/components/features/AurelLogo';

/**
 * Public /unsubscribe?token=<uuid>
 *
 * Click-through depuis le footer des emails marketing (reminder_inactive,
 * milestone_50, feedback_request). Pas d'auth requise — token-gated via la
 * RPC `unsubscribe_via_token`.
 *
 * GDPR : 1-clic, sans login. La RPC retourne toujours ok=true (anti-
 * enumeration) — on affiche donc toujours le succès, même si le token
 * ne match aucun user.
 */
export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  useEffect(() => {
    if (!token) { setStatus('error'); return; }

    let cancelled = false;
    setStatus('loading');
    supabase.rpc('unsubscribe_via_token', { p_token: token }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data?.ok) {
        // eslint-disable-next-line no-console
        console.warn('[Aurel] unsubscribe rpc error', error || data);
        setStatus('error');
        return;
      }
      setStatus('done');
    });

    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><AurelLogo size="lg" /></div>
        <div className="card-padded text-center">
          {status === 'loading' || status === 'idle' ? (
            <>
              <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-aurel-orange" />
              <h1 className="text-xl font-bold text-aurel-ink">Désinscription en cours…</h1>
            </>
          ) : status === 'done' ? (
            <>
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
              <h1 className="mb-2 text-xl font-bold text-aurel-ink">Désinscription enregistrée</h1>
              <p className="mb-6 text-sm text-slate-600">
                Si tu étais inscrit·e aux emails de relance, tu n'en recevras plus. Les emails essentiels (compte créé, certificat émis) restent envoyés. Tu peux te ré-inscrire en répondant à un email Aurel.
              </p>
              <Link to="/login" className="btn-primary btn-block">Retour à la connexion</Link>
            </>
          ) : (
            <>
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-500" />
              <h1 className="mb-2 text-xl font-bold text-aurel-ink">Lien invalide ou expiré</h1>
              <p className="mb-6 text-sm text-slate-600">
                Ce lien de désinscription n'est plus valide. Si tu veux te désinscrire, écris-moi sur WhatsApp ou réponds à un email Aurel.
              </p>
              <Link to="/login" className="btn-primary btn-block">Retour à la connexion</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
