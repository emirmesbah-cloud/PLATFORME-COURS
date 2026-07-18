import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { fetchVdocipherOtp } from '@/lib/queries';
import { useAuth } from '@/hooks/useAuth';
import { Spinner } from '@/components/ui/Spinner';

/**
 * ImmigrationVideoPlayer — VDOCipher player for the Immigration course.
 *
 * Same OTP-signing flow as the Pflege VideoPlayer (server mints a 5-min OTP
 * with a brand watermark via the vdocipher-otp Edge Function), but WITHOUT the
 * Pflege per-second progress tracking : Immigration progress is driven by the
 * "mark complete" button + the per-lesson quiz, not by watched-seconds.
 *
 * Render only happens when the caller already knows the lesson is published and
 * has a video id (see ImmigrationLessonReader). If the OTP call is rejected
 * (e.g. video not published in immigration_lessons) we show a friendly error.
 */
export function ImmigrationVideoPlayer({ videoId, title }: { videoId: string; title: string }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  async function handleForceReauth() {
    await signOut();
    navigate('/login', { replace: true, state: { sessionExpired: true } });
  }

  const otpQ = useQuery({
    queryKey: ['immigration-vdocipher-otp', videoId],
    queryFn: () => fetchVdocipherOtp(videoId),
    enabled: !!videoId,
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: (n, err) => {
      const msg = (err as Error)?.message || '';
      if (msg.includes('NOT_AUTHENTICATED') || msg.includes('401')) return false;
      return n < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
  });

  if (otpQ.isLoading) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-card bg-zinc-950 text-white">
        <Spinner label="Préparation du player..." />
      </div>
    );
  }

  if (otpQ.isError || !otpQ.data) {
    const errMsg = otpQ.error instanceof Error ? otpQ.error.message : 'Erreur inconnue';
    const isAuthError = errMsg.includes('NOT_AUTHENTICATED') || errMsg.includes('401');
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-card bg-zinc-950 text-white">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-400" />
          <div className="font-semibold">
            {isAuthError ? 'Session expirée' : "Le player n'a pas pu charger"}
          </div>
          <p className="max-w-sm text-sm text-zinc-400">
            {isAuthError
              ? 'Ta connexion a été invalidée. Reconnecte-toi pour reprendre la vidéo.'
              : errMsg.includes('INVALID_VIDEO')
              ? "Cette leçon n'est pas encore disponible."
              : 'Réessaie dans un instant.'}
          </p>
          <div className="mt-2">
            {isAuthError ? (
              <button onClick={handleForceReauth} className="btn-primary">Se reconnecter</button>
            ) : (
              <button onClick={() => otpQ.refetch()} className="btn-primary">Réessayer</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { otp, playbackInfo } = otpQ.data;
  const iframeSrc =
    `https://player.vdocipher.com/v2/?otp=${encodeURIComponent(otp)}` +
    `&playbackInfo=${encodeURIComponent(playbackInfo)}` +
    `&primaryColor=F97316`;

  return (
    <div className="aspect-video w-full overflow-hidden rounded-card bg-black">
      <iframe
        key={otp}
        src={iframeSrc}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        className="h-full w-full border-0"
        title={title}
      />
    </div>
  );
}
