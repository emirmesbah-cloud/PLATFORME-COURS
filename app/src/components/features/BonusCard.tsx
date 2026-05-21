import { useState } from 'react';
import { Download, Loader2, FileText, Lock } from 'lucide-react';
import type { BonusResource } from '@/lib/types';
import { getBonusSignedUrl, logBonusDownload } from '@/lib/queries';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';

export function BonusCard({ bonus }: { bonus: BonusResource }) {
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();
  const { user } = useAuth();

  async function handleDownload() {
    if (!bonus.file_url) {
      toast.info('Ce bonus sera disponible très bientôt. Aurel le finalise.', 'Bientôt disponible');
      return;
    }
    if (!user) return;
    setDownloading(true);

    // SHERLOCK R13 — B2: window.open('', '_blank') returns null on modern
    // Chrome even from a sync click. Use a temporary anchor instead: the
    // browser handles the navigation just like a native link click, no
    // popup-blocker false positives, and no fallback that would nuke the
    // current SPA route via window.location.href.
    try {
      const signed = await getBonusSignedUrl(bonus);
      if (!signed) throw new Error('No signed URL');
      // logBonusDownload fire-and-forget : on ne fait pas attendre l'user
      // pour l'écriture en DB. Si le INSERT échoue (rate-limit unique idx
      // de mig 014), pas grave — l'effet UX reste juste.
      logBonusDownload(bonus.id, user.id).catch(() => {});

      const a = document.createElement('a');
      a.href = signed;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.download = '';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      toast.success(`Téléchargement de "${bonus.name}" lancé.`);
    } catch {
      toast.error('Erreur lors du téléchargement. Réessaie.', 'Téléchargement impossible');
    } finally {
      setDownloading(false);
    }
  }

  const available = !!bonus.file_url && bonus.is_published;

  return (
    <div className="card-padded flex h-full flex-col">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-aurel-orange-soft text-aurel-orange-dark">
          <FileText className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-aurel-ink">{bonus.name}</h3>
          <span className="text-xs uppercase tracking-wide text-slate-400">{bonus.file_type}</span>
        </div>
      </div>
      <p className="mb-4 line-clamp-4 flex-1 text-sm text-slate-600">{bonus.description}</p>
      <button
        onClick={handleDownload}
        disabled={downloading}
        className={available ? 'btn-secondary' : 'btn-outline'}
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : available ? (
          <Download className="h-4 w-4" />
        ) : (
          <Lock className="h-4 w-4" />
        )}
        {available ? 'Télécharger' : 'Bientôt disponible'}
      </button>
    </div>
  );
}
