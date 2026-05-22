import { useEffect, useMemo, useRef } from 'react';
import { Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { DISCLAIMER_VDOCIPHER_VIDEO_ID, DISCLAIMER_VIDEO_UPLOADED } from '@/lib/disclaimer-config';

/**
 * DisclaimerVideoPlayer — separate from VideoPlayer.tsx (which is for paid
 * lessons). This one is locked-down for the legal disclaimer :
 *   - playbackRates locked to [1.0] (no speed-up via VDOCipher URL params)
 *   - controls minimized via player URL params
 *   - watermark with user identity for any leaked screen-recording forensics
 *
 * The REAL anti-bypass is server-side (start_disclaimer + acknowledge_disclaimer
 * enforce wall-clock min duration in SQL). The client-side restrictions are
 * just UX — even if a user circumvents them, they can't acknowledge the
 * disclaimer until 90 wall-clock seconds have elapsed.
 *
 * Placeholder shown if DISCLAIMER_VDOCIPHER_VIDEO_ID is empty (= video not yet
 * uploaded by admin). In that state the page is still navigable but the
 * Continuer button stays disabled, so the user sees the disclaimer flow even
 * before the video exists.
 */
export function DisclaimerVideoPlayer() {
  const { profile } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-use the watermark pattern from VideoPlayer.tsx — memoized via primitive
  // fields (not object reference) to avoid useEffect re-runs on profile mutations.
  const watermark = useMemo(() => {
    if (!profile) return '';
    return `${profile.first_name} ${profile.last_name} · ${profile.email}`;
  }, [profile?.first_name, profile?.last_name, profile?.email]);

  useEffect(() => {
    if (!DISCLAIMER_VIDEO_UPLOADED || !containerRef.current) return;
    const iframe = document.createElement('iframe');
    // VDOCipher player URL with locked-down config :
    //   - primaryColor : matches Aurel orange brand.
    //   - watermark    : forensic deterrent against screen-rec leaks.
    //   - playbackRates=1 : limits speed selector to 1x only (when supported).
    //   - disableInfo=1   : hides "more videos" / share / info buttons.
    iframe.src =
      `https://player.vdocipher.com/v2/?video=${encodeURIComponent(DISCLAIMER_VDOCIPHER_VIDEO_ID)}` +
      `&primaryColor=F97316` +
      `&watermark=${encodeURIComponent(watermark)}` +
      `&playbackRates=1` +
      `&disableInfo=1`;
    iframe.allow = 'autoplay; fullscreen; encrypted-media';
    iframe.allowFullscreen = true;
    iframe.className = 'h-full w-full border-0';
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(iframe);
  }, [watermark]);

  if (!DISCLAIMER_VIDEO_UPLOADED) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl bg-aurel-dark text-white">
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <Lock className="h-10 w-10 text-aurel-orange" />
          <div className="font-semibold">Vidéo de disclaimer en préparation</div>
          <p className="max-w-sm text-sm text-slate-400">
            Aurel finalise l'enregistrement. Le bouton ci-dessous reste désactivé tant que la vidéo n'est pas en ligne.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
