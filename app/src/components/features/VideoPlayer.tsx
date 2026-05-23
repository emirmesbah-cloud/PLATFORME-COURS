import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, AlertTriangle } from 'lucide-react';
import { rpcUpdateLessonProgress, fetchVdocipherOtp } from '@/lib/queries';
import type { Lesson } from '@/lib/types';
import { Spinner } from '@/components/ui/Spinner';

/**
 * VideoPlayer — VDOCipher iframe with server-side OTP signing.
 *
 * Flow :
 *   1. If lesson has no vdocipher_video_id → show "Bientôt" placeholder.
 *   2. Call the vdocipher-otp Edge Function with video_id → get otp + playbackInfo.
 *      The Edge Function checks auth + that the video belongs to a published
 *      lesson + adds a per-user watermark via VDOCipher's API.
 *   3. Render iframe with otp + playbackInfo as query params.
 *   4. Track watched-seconds approximately (1s tick when visible) and POST
 *      to update_lesson_progress every 10s.
 *
 * Why server-side OTP :
 *   VDOCipher videos are DRM-protected by default. The public embed URL
 *   (?video=ID) returns "Error: 400 Missing parameters" for DRM videos.
 *   Mint OTPs server-side from our Edge Function so the secret API key
 *   never reaches the browser.
 *
 * Bug history :
 *   - Sentry 267a672ca8134e3b9... was caused by old code that did
 *     containerRef.innerHTML='' inside useEffect. React's reconciler
 *     then tried to removeChild on stripped nodes → NotFoundError →
 *     entire /lecons/:n crashed. Fixed by switching to JSX-only iframe
 *     with a stable `key`. No more imperative DOM manipulation.
 */
export function VideoPlayer({ lesson, initialPosition = 0 }: {
  lesson: Lesson;
  initialPosition?: number;
}) {
  const watchedSecRef = useRef<number>(0);
  const positionSecRef = useRef<number>(initialPosition);
  const startTsRef = useRef<number>(0);

  // OTP fetch — re-fetches when the lesson changes. staleTime 4 min so we
  // re-use the OTP if the user closes the lesson page and re-opens within
  // the 5-min TTL window (saves an Edge Function call).
  const otpQ = useQuery({
    queryKey: ['vdocipher-otp', lesson.id, lesson.vdocipher_video_id],
    queryFn: () => fetchVdocipherOtp(lesson.vdocipher_video_id!),
    enabled: !!lesson.vdocipher_video_id,
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Save progress every 10s + final flush at unmount.
  useEffect(() => {
    if (!lesson.vdocipher_video_id) return;
    const i = setInterval(() => {
      if (watchedSecRef.current <= 0) return;
      rpcUpdateLessonProgress({
        lessonId: lesson.id,
        watchedSeconds: Math.round(watchedSecRef.current),
        positionSeconds: Math.round(positionSecRef.current),
      }).catch(() => {});
    }, 10_000);
    return () => {
      clearInterval(i);
      if (watchedSecRef.current > 0) {
        rpcUpdateLessonProgress({
          lessonId: lesson.id,
          watchedSeconds: Math.round(watchedSecRef.current),
          positionSeconds: Math.round(positionSecRef.current),
        }).catch(() => {});
      }
    };
  }, [lesson.id, lesson.vdocipher_video_id]);

  // Approximate watched-seconds : count time the page is visible while the
  // player is mounted. Real precise tracking requires VDOCipher's player.js
  // SDK + postMessage events (Phase 3). Note serveur-side :
  // update_lesson_progress (mig 013) caps watched_seconds à 120% de la durée
  // + limite l'incrément entre deux calls à wall-clock plausible.
  useEffect(() => {
    if (!lesson.vdocipher_video_id) return;
    startTsRef.current = Date.now();
    watchedSecRef.current = 0;
    positionSecRef.current = initialPosition;
    const tick = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = (Date.now() - startTsRef.current) / 1000;
        watchedSecRef.current = elapsed;
        positionSecRef.current = elapsed;
      }
    };
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lesson.vdocipher_video_id, initialPosition]);

  // ── Render states ────────────────────────────────────────────────────────
  if (!lesson.vdocipher_video_id) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-aurel-dark text-white">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <Lock className="h-10 w-10 text-aurel-orange" />
          <div className="font-semibold">Cette leçon arrive très bientôt</div>
          <p className="max-w-sm text-sm text-slate-400">Aurel finalise l'enregistrement. Reviens dans quelques jours.</p>
        </div>
      </div>
    );
  }

  if (otpQ.isLoading) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-aurel-dark text-white">
        <Spinner label="Préparation du player..." />
      </div>
    );
  }

  if (otpQ.isError || !otpQ.data) {
    const errMsg = otpQ.error instanceof Error ? otpQ.error.message : 'Erreur inconnue';
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-aurel-dark text-white">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-400" />
          <div className="font-semibold">Le player n'a pas pu charger</div>
          <p className="max-w-sm text-sm text-slate-400">
            {errMsg.includes('INVALID_VIDEO') ? 'Cette leçon n\'est pas encore disponible.' : 'Réessaie dans un instant.'}
          </p>
          <button
            onClick={() => otpQ.refetch()}
            className="mt-2 rounded-md bg-aurel-orange px-4 py-2 text-sm font-semibold text-white hover:bg-aurel-orange-dark"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  // SHERLOCK R6 fix : iOS Safari needs explicit autoplay/fullscreen/PiP
  // perms to enter fullscreen on tap. Was just 'encrypted-media' →
  // tap-to-fullscreen silently failed on iPhone PWA standalone.
  const { otp, playbackInfo } = otpQ.data;
  const iframeSrc =
    `https://player.vdocipher.com/v2/?otp=${encodeURIComponent(otp)}` +
    `&playbackInfo=${encodeURIComponent(playbackInfo)}` +
    `&primaryColor=F97316`;

  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
      <iframe
        key={otp}
        src={iframeSrc}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        className="h-full w-full border-0"
        title={lesson.title}
      />
    </div>
  );
}
