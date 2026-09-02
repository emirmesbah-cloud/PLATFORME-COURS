import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Lock, AlertTriangle } from 'lucide-react';
import { rpcUpdateLessonProgress, fetchVdocipherOtp } from '@/lib/queries';
import { useAuth } from '@/hooks/useAuth';
import type { Lesson } from '@/lib/types';
import { Spinner } from '@/components/ui/Spinner';

type VdoPlayerInstance = {
  video: {
    currentTime: number;
    addEventListener: (name: string, handler: () => void) => void;
    removeEventListener: (name: string, handler: () => void) => void;
  };
  api: { getTotalPlayed: () => Promise<number> };
};

declare global {
  interface Window {
    VdoPlayer?: { getInstance: (iframe: HTMLIFrameElement) => VdoPlayerInstance };
  }
}

let vdoApiPromise: Promise<void> | null = null;

function loadVdoPlayerApi(): Promise<void> {
  if (window.VdoPlayer) return Promise.resolve();
  if (vdoApiPromise) return vdoApiPromise;

  vdoApiPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-aurel-vdocipher-api]');
    const script = existing ?? document.createElement('script');
    const timeout = window.setTimeout(() => reject(new Error('VDOCIPHER_API_TIMEOUT')), 10_000);
    const ready = () => {
      window.clearTimeout(timeout);
      if (window.VdoPlayer) resolve();
      else reject(new Error('VDOCIPHER_API_UNAVAILABLE'));
    };
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', () => {
      window.clearTimeout(timeout);
      reject(new Error('VDOCIPHER_API_LOAD_FAILED'));
    }, { once: true });
    if (!existing) {
      script.src = 'https://player.vdocipher.com/v2/api.js';
      script.async = true;
      script.dataset.aurelVdocipherApi = 'true';
      document.head.appendChild(script);
    }
  }).catch((error) => {
    vdoApiPromise = null;
    throw error;
  });
  return vdoApiPromise;
}

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
export function VideoPlayer({ lesson, initialPosition = 0, initialWatched = 0 }: {
  lesson: Lesson;
  initialPosition?: number;
  initialWatched?: number;
}) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const watchedSecRef = useRef<number>(initialWatched);
  const positionSecRef = useRef<number>(initialPosition);
  const apiTrackingRef = useRef(false);

  // Triggered when the OTP fetch returns NOT_AUTHENTICATED even after
  // refreshSession() retry. The student's local session is unrecoverable
  // (typically : JWT signed with rotated keys, refresh_token also dead).
  // One-click signOut + redirect to /login gives them a clean restart.
  async function handleForceReauth() {
    await signOut();
    navigate('/login', { replace: true, state: { sessionExpired: true } });
  }

  // OTP fetch — re-fetches when the lesson changes. staleTime 4 min so we
  // re-use the OTP if the user closes the lesson page and re-opens within
  // the 5-min TTL window (saves an Edge Function call).
  //
  // RETRY STRATEGY :
  // 3 retries with exponential backoff (1s, 2s, 4s). Covers transient
  // network blips on slow Algerian ISPs + brief Edge Function cold starts.
  // After 3 retries the error UI shows with a manual "Réessayer" button.
  const otpQ = useQuery({
    queryKey: ['vdocipher-otp', lesson.id, lesson.vdocipher_video_id],
    queryFn: () => fetchVdocipherOtp(lesson.vdocipher_video_id!),
    enabled: !!lesson.vdocipher_video_id,
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    // R22 : skip retries on NOT_AUTHENTICATED. Retrying 3× burns 7s before
    // showing the "Se reconnecter" UI, but auth errors won't fix themselves
    // — they need a fresh login. Other errors (network blips) get 3 retries.
    retry: (n, err) => {
      const msg = (err as Error)?.message || '';
      if (msg.includes('NOT_AUTHENTICATED') || msg.includes('401')) return false;
      return n < 3;
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
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

  // Prefer VdoCipher's official playback API. getTotalPlayed counts actual
  // playback for this player instance and currentTime gives the real resume
  // position, including seeks and pauses.
  useEffect(() => {
    if (!otpQ.data || !lesson.vdocipher_video_id) return;
    let disposed = false;
    let player: VdoPlayerInstance | null = null;
    let lastSampleAt = 0;

    const sample = async () => {
      if (!player || disposed) return;
      const now = Date.now();
      if (now - lastSampleAt < 900) return;
      lastSampleAt = now;
      try {
        const sessionPlayed = Number(await player.api.getTotalPlayed());
        const currentTime = Number(player.video.currentTime);
        if (Number.isFinite(sessionPlayed) && sessionPlayed >= 0) {
          watchedSecRef.current = Math.max(
            watchedSecRef.current,
            initialWatched + sessionPlayed,
          );
        }
        if (Number.isFinite(currentTime) && currentTime >= 0) {
          positionSecRef.current = currentTime;
        }
      } catch {
        // The conservative focus-based fallback below remains active if the
        // cross-frame API is temporarily unavailable.
      }
    };

    void loadVdoPlayerApi().then(() => {
      if (disposed || !iframeRef.current || !window.VdoPlayer) return;
      player = window.VdoPlayer.getInstance(iframeRef.current);
      apiTrackingRef.current = true;
      player.video.addEventListener('timeupdate', sample);
      player.video.addEventListener('pause', sample);
      player.video.addEventListener('ended', sample);
      if (initialPosition > 0) {
        try { player.video.currentTime = initialPosition; } catch { /* resume remains best-effort */ }
      }
      void sample();
    }).catch(() => {
      apiTrackingRef.current = false;
    });

    return () => {
      disposed = true;
      apiTrackingRef.current = false;
      if (player) {
        player.video.removeEventListener('timeupdate', sample);
        player.video.removeEventListener('pause', sample);
        player.video.removeEventListener('ended', sample);
      }
    };
  }, [initialPosition, initialWatched, lesson.vdocipher_video_id, otpQ.data]);

  // Conservative fallback when VdoCipher's player API cannot load.
  //
  // BEFORE : tick() incremented `watchedSec = (Date.now - startTs) / 1000`
  //          every second whenever `document.visibilityState === 'visible'`.
  //          A student opening lesson 5 (8 min, threshold 432s) and walking
  //          away with the tab focused would auto-complete in 7.2 min of
  //          IDLE time. Server-side clamp (120% of duration) doesn't help
  //          because the wall-clock IS the over-credit source.
  //
  // NOW : only tick when ALL of :
  //   1. document.visibilityState === 'visible' (tab in foreground)
  //   2. document.hasFocus() (window has OS focus — caught Alt-Tab away)
  //   3. The VDOCipher iframe is the focused element (means user clicked
  //      Play and the player has focus — catches "tab open but reading
  //      another tab's content while music plays elsewhere" cases)
  //
  // The 3rd check uses document.activeElement. After user clicks play, the
  // iframe becomes the active element. If they click outside (notes panel,
  // navigation, etc.), the count pauses.
  //
  // True precise tracking requires VDOCipher player.js postMessage API
  // (timeupdate / play / pause events). That's Phase 3. For now this stopgap
  // eliminates the worst over-credit case (AFK tab focused).
  useEffect(() => {
    if (!lesson.vdocipher_video_id) return;
    let accumulated = 0;
    let lastTick = Date.now();
    watchedSecRef.current = Math.max(watchedSecRef.current, initialWatched);
    positionSecRef.current = initialPosition;
    const tick = () => {
      const now = Date.now();
      const delta = (now - lastTick) / 1000;
      lastTick = now;

      const visible = document.visibilityState === 'visible';
      const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      const activeEl = document.activeElement;
      const iframeActive = activeEl?.tagName === 'IFRAME';

      // Only credit time if the user is genuinely engaged with the player.
      // Cap the per-tick delta at 2s to handle sleep/freeze gaps (tick was
      // supposed to fire at 1s but didn't because the tab was throttled).
      if (!apiTrackingRef.current && visible && focused && iframeActive && delta <= 2) {
        accumulated += delta;
        watchedSecRef.current = Math.max(watchedSecRef.current, initialWatched + accumulated);
        positionSecRef.current = initialPosition + accumulated;
      }
    };
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lesson.vdocipher_video_id, initialPosition, initialWatched]);

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
    const isAuthError = errMsg.includes('NOT_AUTHENTICATED') || errMsg.includes('401');
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-aurel-dark text-white">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-400" />
          <div className="font-semibold">
            {isAuthError ? 'Session expirée' : 'Le player n\'a pas pu charger'}
          </div>
          <p className="max-w-sm text-sm text-slate-400">
            {isAuthError
              ? 'Ta connexion a été invalidée (mise à jour serveur). Reconnecte-toi pour reprendre la vidéo.'
              : errMsg.includes('INVALID_VIDEO')
              ? 'Cette leçon n\'est pas encore disponible.'
              : 'Réessaie dans un instant.'}
          </p>
          {!isAuthError && (
            <code className="mt-1 max-w-md break-all rounded bg-black/30 px-2 py-1 text-[10px] text-amber-200">
              {errMsg}
            </code>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {isAuthError ? (
              <button
                onClick={handleForceReauth}
                className="rounded-md bg-aurel-orange px-4 py-2 text-sm font-semibold text-white hover:bg-aurel-orange-dark"
              >
                Se reconnecter
              </button>
            ) : (
              <button
                onClick={() => otpQ.refetch()}
                className="rounded-md bg-aurel-orange px-4 py-2 text-sm font-semibold text-white hover:bg-aurel-orange-dark"
              >
                Réessayer
              </button>
            )}
          </div>
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

  // Detect Chrome DevTools mobile emulation. Real mobile devices have
  // their native DRM (Widevine on Android, FairPlay on iOS). DevTools
  // emulation sends a mobile UA but uses the underlying desktop browser's
  // DRM (Widevine only on desktop Chrome). When VDOCipher detects iOS UA
  // it tries FairPlay → Chrome can't supply it → Error 2112.
  const isLikelyEmulation =
    typeof navigator !== 'undefined' &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    // Real iOS = touch device. DevTools emulation = no touch.
    !('ontouchend' in document);

  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
      <iframe
        ref={iframeRef}
        key={otp}
        src={iframeSrc}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        className="h-full w-full border-0"
        title={lesson.title}
      />
      {isLikelyEmulation && (
        <div className="bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          ⚠️ <strong>Mode émulation détecté.</strong> Si la vidéo ne joue pas (Error 2112), c'est une limitation de Chrome DevTools — pas un bug de l'app.
          Teste sur un vrai téléphone : ça fonctionnera.
        </div>
      )}
    </div>
  );
}
