import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, Loader2, FileText } from 'lucide-react';
import { fetchBonus, adminUpdateBonus, queryKeys, getBonusSignedUrl } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import type { BonusResource } from '@/lib/types';

export function AdminBonus() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: queryKeys.bonus, queryFn: fetchBonus });
  const bonus = data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink">Ressources bonus</h1>
        <p className="mt-1 text-slate-600">Upload les fichiers DOCX dans le bucket privé <code className="rounded bg-slate-100 px-1 text-xs">bonus-resources</code>. Les étudiants téléchargent via signed URL.</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {isLoading && bonus.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card-padded animate-pulse">
                <div className="mb-3 h-12 w-12 rounded-lg bg-slate-200" />
                <div className="mb-2 h-4 w-2/3 rounded bg-slate-200" />
                <div className="h-3 w-full rounded bg-slate-100" />
              </div>
            ))
          : bonus.map((b) => (
              <BonusRow
                key={b.id}
                bonus={b}
                onTogglePublished={(v) => adminUpdateBonus(b.id, { is_published: v })
                  .then(() => { qc.invalidateQueries({ queryKey: queryKeys.bonus }); toast.success('Mis à jour.'); })
                  .catch(() => toast.error('Erreur.'))
                }
                onUploaded={(path) => adminUpdateBonus(b.id, { file_url: path })
                  .then(() => { qc.invalidateQueries({ queryKey: queryKeys.bonus }); toast.success('Fichier lié.'); })
                  .catch(() => toast.error('Erreur.'))
                }
              />
            ))}
      </div>
    </div>
  );
}

function BonusRow({ bonus, onTogglePublished, onUploaded }: {
  bonus: BonusResource;
  onTogglePublished: (v: boolean) => Promise<void>;
  onUploaded: (path: string) => Promise<void>;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // SHERLOCK R13 — B13: client-side validation (size + extension) before
    // hitting Supabase storage. Server-side rules still apply (RLS + bucket
    // limits) — this just gives instant feedback and stops obviously bad
    // uploads from wasting bandwidth.
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['docx', 'pdf'].includes(ext)) {
      toast.error('Format invalide. Seuls .docx et .pdf sont acceptés.');
      e.target.value = '';
      return;
    }
    if (file.size > 25_000_000) {
      toast.error('Fichier trop volumineux (max 25 MB).');
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      // SHERLOCK R13 — C5: random suffix via crypto.randomUUID() instead of
      // Date.now(). Date.now() collides under rapid double-upload from
      // distinct admin tabs and is also guessable, which matters slightly
      // because the bucket is private but signed URLs are bearer-style.
      const path = `${bonus.course}/bonus-${bonus.order_index}-${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('bonus-resources').upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      await onUploaded(path);
    } catch (err) {
      console.error(err);
      toast.error('Upload impossible. Vérifie le bucket et réessaie.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDownloadCurrent() {
    if (!bonus.file_url) return;
    setDownloading(true);
    try {
      const url = await getBonusSignedUrl(bonus);
      if (url) window.open(url, '_blank', 'noopener');
    } catch {
      toast.error('Erreur de téléchargement.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="card-padded flex h-full flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-aurel-orange-soft text-aurel-orange-dark">
          <FileText className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-aurel-ink">{bonus.name}</div>
          <p className="line-clamp-2 text-xs text-slate-500">{bonus.description}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="btn-outline cursor-pointer">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Upload…' : (bonus.file_url ? 'Remplacer fichier' : 'Uploader fichier')}
          <input type="file" accept=".docx,.pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
        {bonus.file_url && (
          <button onClick={handleDownloadCurrent} disabled={downloading} className="btn-ghost text-sm">
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Télécharger version actuelle
          </button>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3">
        <div className="text-xs">
          <div className="font-mono text-slate-500">{bonus.file_url || 'Aucun fichier'}</div>
        </div>
        <Switch checked={bonus.is_published} onChange={onTogglePublished} label="Publié" />
      </div>
    </div>
  );
}
