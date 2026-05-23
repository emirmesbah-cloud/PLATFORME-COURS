import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { rpcUpdateLessonProgress } from '@/lib/queries';
import { useAuth } from '@/hooks/useAuth';
import type { Lesson } from '@/lib/types';

/**
 * VideoPlayer — wrapper VDOCipher.
 *
 * Si lesson.vdocipher_video_id est null/vide → affiche un placeholder "Bientôt".
 * Sinon → embed VDOCipher iframe avec watermark email + nom.
 *
 * Tracking auto :
 *   - Toutes les 10s : update_lesson_progress(watchedSeconds, positionSeconds)
 *   - Au unmount : flush final
 *
 * BUG FIX (Sentry 267a672ca813...) — was crashing the whole /lecons/:n page
 * with "Failed to execute 'removeChild' on 'Node'". Root cause :
 *   - Old code did `containerRef.current.innerHTML = ''` then appendChild(iframe)
 *     inside a useEffect. This imperatively wiped DOM nodes that React thought
 *     it owned (the !ready placeholder rendered as JSX in the same container).
 *   - When React later tried to reconcile/unmount, it called removeChild on
 *     nodes that no longer existed → NotFoundError → ErrorBoundary catches it
 *     → "Une erreur est survenue sur cette page" everywhere.
 * Fix : render the iframe as a JSX element with a stable `key` so React owns
 * the entire subtree. No more imperative DOM manipulation.
 */
export function VideoPlayer({ lesson, initialPosition = 0 }: {
  lesson: Lesson;
  initialPosition?: number;
}) {
  const { profile } = useAuth();
  const watchedSecRef = useRef<number>(0);
  const positionSecRef = useRef<number>(initialPosition);
  const startTsRef = useRef<number>(0);

  // SHERLOCK FIX : on memoize le watermark via les CHAMPS du profile au lieu
  // de la référence d'objet. Avant, l'effet dépendait directement de
  // `profile`, donc chaque mutation (stub JWT → cache → DB) re-créait l'objet
  // → l'effet re-tournait → reset du tracking watchedSeconds. Sur ISP lent
  // qui hydrate le profile en 2-3 étapes, on perdait des secondes regardées.
  const watermark = useMemo(() => {
    if (!profile) return '';
    return `${profile.first_name} ${profile.last_name} · ${profile.email}`;
  }, [profile?.first_name, profile?.last_name, profile?.email]);

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

  // SHERLOCK R6 fix : iOS Safari needs explicit autoplay/fullscreen/PiP
  // perms to enter fullscreen on tap. Was just 'encrypted-media' →
  // tap-to-fullscreen silently failed on iPhone PWA standalone.
  //
  // Key : the iframe's `key` includes the video ID + watermark so React
  // does a clean remount when either changes (lesson navigation or profile
  // hydration completing). Without the key, React might try to reuse the
  // same iframe element and the watermark wouldn't update.
  const iframeKey = `${lesson.vdocipher_video_id}-${watermark}`;
  const iframeSrc =
    `https://player.vdocipher.com/v2/?video=${encodeURIComponent(lesson.vdocipher_video_id)}` +
    `&primaryColor=F97316&watermark=${encodeURIComponent(watermark)}`;

  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
      <iframe
        key={iframeKey}
        src={iframeSrc}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        className="h-full w-full border-0"
        title={lesson.title}
      />
    </div>
  );
}
