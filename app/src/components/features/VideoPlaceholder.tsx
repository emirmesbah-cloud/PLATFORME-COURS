import { Video, Clock } from 'lucide-react';

/**
 * VideoPlaceholder — shown in a lesson when no video is available yet
 * (vdocipherVideoId is null). Clean, on-brand, reassuring — not a broken
 * player or a 404. Used by the Immigration course during the pre-recording
 * phase. When the real video lands, the player replaces this automatically.
 */
export function VideoPlaceholder({ title }: { title?: string }) {
  return (
    <div
      className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-card border border-zinc-200"
      style={{ background: 'linear-gradient(135deg, #18181B 0%, #0A0A0A 60%, #1a1206 100%)' }}
    >
      {/* Soft orange glow */}
      <div
        className="pointer-events-none absolute -right-1/4 -top-1/4 h-[140%] w-[60%]"
        style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.16), transparent 70%)' }}
      />
      <div className="relative flex flex-col items-center px-6 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-aurel-orange/15 ring-1 ring-aurel-orange/30">
          <Video className="h-7 w-7 text-aurel-orange" />
        </div>
        <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-aurel-orange">
          Vidéo bientôt disponible
        </div>
        <p className="max-w-sm text-[14px] leading-relaxed text-zinc-300">
          {title ? <span className="font-medium text-white">« {title} »</span> : 'Cette leçon'} sera
          filmée prochainement. En attendant, tu peux prendre tes notes et passer le quiz ci-dessous.
        </p>
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-pill bg-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          <Clock className="h-3 w-3" /> Tournage en cours
        </div>
      </div>
    </div>
  );
}
