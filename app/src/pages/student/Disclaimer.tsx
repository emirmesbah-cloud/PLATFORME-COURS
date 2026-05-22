import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { rpcStartDisclaimer, rpcAcknowledgeDisclaimer } from '@/lib/queries';
import { DisclaimerVideoPlayer } from '@/components/features/DisclaimerVideoPlayer';
import { DISCLAIMER_VIDEO_UPLOADED } from '@/lib/disclaimer-config';
import { Spinner } from '@/components/ui/Spinner';

/**
 * /disclaimer — mandatory legal disclaimer gate.
 *
 * Flow :
 *   1. Mount → call start_disclaimer() to anchor the server-side wall-clock timer.
 *   2. Show video (or placeholder if not uploaded yet).
 *   3. Run a client-side countdown matching the server's min_duration_seconds.
 *      When countdown reaches 0, enable the consent checkbox area.
 *   4. User checks "J'ai lu et compris…" + clicks "Continuer".
 *   5. Call acknowledge_disclaimer(consent=true) → server re-verifies wall-clock + consent.
 *      On success : refresh profile in useAuth, navigate to /dashboard.
 *      On TOO_FAST : extend countdown by the server-reported remaining_seconds.
 *
 * Re-watch mode (via /disclaimer?rewatch=1) :
 *   - For users who already acknowledged. No countdown, no Continuer button —
 *     just the video. Doesn't reset disclaimer_acknowledged_at.
 */
export function DisclaimerPage() {
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  // Detect re-watch mode from query string (no router state to avoid stale
  // routing on direct navigation).
  const isRewatch = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('rewatch') === '1';

  const [minSeconds, setMinSeconds] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [consentChecked, setConsentChecked] = useState(false);
  const [ackInFlight, setAckInFlight] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // On mount : start the server-side timer (unless we're in rewatch mode for
  // someone who already acked).
  useEffect(() => {
    if (isRewatch && profile?.disclaimer_acknowledged_at) {
      // Re-watch only — no need to call start_disclaimer.
      setMinSeconds(0);
      return;
    }
    let cancelled = false;
    rpcStartDisclaimer()
      .then((res) => {
        if (cancelled) return;
        if (!res?.ok) {
          setStartError('Erreur au démarrage du disclaimer. Réessaie dans un instant.');
          return;
        }
        setMinSeconds(res.min_duration_seconds);
        setRemainingSeconds(res.min_duration_seconds);
      })
      .catch(() => {
        if (cancelled) return;
        setStartError('Connexion lente — réessaie dans un instant.');
      });
    return () => { cancelled = true; };
  }, [isRewatch, profile?.disclaimer_acknowledged_at]);

  // Countdown — runs only when not in rewatch mode and we have a min_seconds.
  useEffect(() => {
    if (isRewatch && profile?.disclaimer_acknowledged_at) return;
    if (minSeconds === null) return;
    if (remainingSeconds <= 0) return;
    const t = setInterval(() => {
      setRemainingSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [minSeconds, remainingSeconds, isRewatch, profile?.disclaimer_acknowledged_at]);

  const canContinue = remainingSeconds <= 0 && consentChecked && !ackInFlight;

  async function handleContinue() {
    if (!canContinue) return;
    setAckInFlight(true);
    try {
      const res = await rpcAcknowledgeDisclaimer(true);
      if (res.ok) {
        toast.success('Bienvenue dans ta formation !');
        // Refresh the profile so the route guard sees disclaimer_acknowledged_at set.
        await refreshProfile();
        navigate('/dashboard', { replace: true });
        return;
      }
      if (res.error === 'TOO_FAST') {
        // Server says we haven't waited long enough — sync our client timer
        // to the server's remaining_seconds (anti-tampering safeguard).
        const remaining = Math.ceil(res.remaining_seconds ?? 1);
        setRemainingSeconds(remaining);
        toast.error(`Patiente encore ${remaining}s avant de continuer.`);
      } else if (res.error === 'CONSENT_REQUIRED') {
        toast.error('Tu dois cocher la case avant de continuer.');
        setConsentChecked(false);
      } else if (res.error === 'NEVER_STARTED') {
        // Rare : timer wasn't anchored. Retry from scratch.
        toast.error('Erreur — recharge la page.');
      } else {
        toast.error('Erreur inconnue, réessaie.');
      }
    } catch {
      toast.error('Connexion lente — réessaie dans un instant.');
    } finally {
      setAckInFlight(false);
    }
  }

  // Loading state : waiting on start_disclaimer.
  if (minSeconds === null && !startError) {
    return <Spinner label="Chargement du disclaimer…" />;
  }

  return (
    <div className="min-h-screen bg-aurel-dark py-8 px-4 text-white">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-aurel-orange/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-aurel-orange">
            <AlertTriangle className="h-3.5 w-3.5" />
            Avant de commencer
          </div>
          <h1 className="text-2xl font-bold md:text-3xl">
            Disclaimer obligatoire
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            Regarde la vidéo ci-dessous en intégralité.
            {!isRewatch && ' Tu ne peux pas accéder à tes leçons avant.'}
          </p>
        </header>

        {startError && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            {startError}
          </div>
        )}

        {/* Video */}
        <DisclaimerVideoPlayer />

        {/* Re-watch mode : just a back button, no consent flow */}
        {isRewatch && profile?.disclaimer_acknowledged_at ? (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => navigate('/profil')}
              className="rounded-lg bg-aurel-orange px-6 py-3 font-semibold text-white hover:bg-aurel-orange-dark"
            >
              Retour au profil
            </button>
          </div>
        ) : (
          <>
            {/* Countdown or "ready" status */}
            <div className="mt-6 flex items-center justify-center gap-2 text-sm">
              {remainingSeconds > 0 ? (
                <span className="text-slate-400">
                  Patiente encore <strong className="font-mono text-aurel-orange">{remainingSeconds}s</strong> avant de pouvoir continuer.
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Tu peux maintenant continuer.
                </span>
              )}
            </div>

            {/* Consent + Continuer */}
            <div className="mt-6 rounded-xl border border-slate-700 bg-aurel-dark p-5">
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  disabled={remainingSeconds > 0}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-500 bg-aurel-dark text-aurel-orange focus:ring-2 focus:ring-aurel-orange disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className={remainingSeconds > 0 ? 'text-slate-500' : 'text-slate-200'}>
                  J'ai lu et compris les conditions présentées dans cette vidéo, et je confirme accepter les termes de la formation Aurel Academy.
                </span>
              </label>

              <button
                type="button"
                onClick={handleContinue}
                disabled={!canContinue}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-aurel-orange px-6 py-3 font-semibold text-white transition hover:bg-aurel-orange-dark disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-400"
              >
                {ackInFlight ? 'Validation…' : (
                  <>
                    Continuer vers ma formation <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              {!DISCLAIMER_VIDEO_UPLOADED && (
                <p className="mt-3 text-center text-xs text-slate-500">
                  ⚠️ La vidéo de disclaimer n'est pas encore en ligne. Reviens dans quelques jours.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
