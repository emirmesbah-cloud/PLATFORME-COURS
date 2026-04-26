import { useEffect, useRef, useState } from 'react';
import { Lock, Play } from 'lucide-react';
import { rpcUpdateLessonProgress } from '@/lib/queries';
import { useAuth } from '@/hooks/useAuth';
import type { Lesson } from '@/lib/types';

/**
 * VideoPlayer — wrapper VDOCipher.
 *
 * Si lesson.vdocipher_video_id est null/vide → affiche un placeholder "Bientôt".
 * Sinon → instancie le player VDOCipher avec watermark email + nom.
 *
 * Tracking auto :
 *   - Toutes les 10s : update_lesson_progress(watchedSeconds, positionSeconds)
 *   - Au unmount : flush final
 */
export function VideoPlayer({ lesson, initialPosition = 0 }: {
  lesson: Lesson;
  initialPosition?: number;
}) {
  const { user, profile } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const watchedSecRef = useRef<number>(0);
  const positionSecRef = useRef<number>(initialPosition);
  const [ready, setReady] = useState(false);

  // Save progress every 10s
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

  // VDOCipher embed (basic — real OTP/playbackInfo flow requires a backend signing endpoint).
  // For Phase 2 MVP, we render the iframe with the public embed URL pattern.
  // Backend signing → Phase 3.
  useEffect(() => {
    if (!lesson.vdocipher_video_id || !containerRef.current) return;
    const watermark = profile ? `${profile.first_name} ${profile.last_name} · ${profile.email}` : '';
    const iframe = document.createElement('iframe');
    iframe.src =
      `https://player.vdocipher.com/v2/?video=${encodeURIComponent(lesson.vdocipher_video_id)}` +
      `&primaryColor=F97316&watermark=${encodeURIComponent(watermark)}`;
    iframe.allow = 'encrypted-media';
    iframe.allowFullscreen = true;
    iframe.className = 'h-full w-full border-0';
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(iframe);

    // Approximate watched-seconds : count time the page is visible while iframe is mounted.
    // Real precise tracking requires VDOCipher's player.js SDK + postMessage events (Phase 3).
    const startTs = Date.now();
    const tick = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = (Date.now() - startTs) / 1000;
        watchedSecRef.current = elapsed;
        positionSecRef.current = elapsed;
      }
    };
    const interval = setInterval(tick, 1000);
    setReady(true);
    return () => clearInterval(interval);
  }, [lesson.vdocipher_video_id, profile, user?.id]);

  if (!lesson.vdocipher_video_id) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-aurel-dark text-white">
        <div className="flex flex-col items-center gap-3 text-center">
          <Lock className="h-10 w-10 text-aurel-orange" />
          <div className="font-semibold">Cette leçon arrive très bientôt</div>
          <p className="max-w-sm text-sm text-slate-400">Aurel finalise l'enregistrement. Reviens dans quelques jours.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
      <div ref={containerRef} className="h-full w-full">
        {!ready && (
          <div className="flex h-full items-center justify-center text-white">
            <Play className="h-10 w-10" />
          </div>
        )}
      </div>
    </div>
  );
}
