import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Gauge, Loader2, Save, ShieldCheck, Youtube } from 'lucide-react';
import {
  fetchReadinessSimulatorSettings,
  queryKeys,
  saveReadinessSimulatorLiveUrl,
} from '@/lib/queries';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime } from '@/lib/utils';

const SIMULATOR_URL = 'https://aurel-academy.com/readiness/';
const LIVE_REDIRECT_URL = 'https://dvrqtqghgaxhhgkoihcj.supabase.co/functions/v1/readiness-live';
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

function normalizeYouTubeLiveUrl(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Colle un lien YouTube complet et valide.');
  }

  if (url.protocol !== 'https:' || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('Le lien doit venir de youtube.com ou youtu.be et commencer par https://.');
  }
  if (url.username || url.password || url.port) {
    throw new Error('Ce lien YouTube contient des éléments non autorisés.');
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  const videoId = host === 'youtu.be'
    ? segments[0]
    : segments[0] === 'live'
      ? segments[1]
      : segments[0] === 'watch'
        ? url.searchParams.get('v')
        : null;

  if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    throw new Error('Utilise le lien de partage du Live : youtube.com/live/…, youtube.com/watch?v=… ou youtu.be/….');
  }

  url.hash = '';
  return url.toString();
}

export function AdminReadinessSimulator() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settingsQ = useQuery({
    queryKey: queryKeys.readinessSimulatorSettings,
    queryFn: fetchReadinessSimulatorSettings,
  });
  const [draftUrl, setDraftUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settingsQ.data) setDraftUrl(settingsQ.data.live_url);
  }, [settingsQ.data]);

  const isChanged = useMemo(
    () => Boolean(settingsQ.data && draftUrl.trim() !== settingsQ.data.live_url),
    [draftUrl, settingsQ.data],
  );

  async function save() {
    if (!settingsQ.data) return;

    let normalized: string;
    try {
      normalized = normalizeYouTubeLiveUrl(draftUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Lien YouTube invalide.');
      return;
    }

    if (normalized === settingsQ.data.live_url) {
      setDraftUrl(normalized);
      toast.success('Ce lien est déjà actif.');
      return;
    }

    const confirmed = window.confirm(
      "Remplacer le Live actif ? Dès l'enregistrement, l'ancien lien ne sera plus utilisé par le simulateur.",
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const next = await saveReadinessSimulatorLiveUrl(normalized);
      queryClient.setQueryData(queryKeys.readinessSimulatorSettings, next);
      setDraftUrl(next.live_url);
      await queryClient.invalidateQueries({ queryKey: queryKeys.readinessSimulatorSettings });
      toast.success("Nouveau Live activé. L'ancien lien a été remplacé.", 'Publié');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Le lien n'a pas pu être enregistré.");
    } finally {
      setSaving(false);
    }
  }

  if (settingsQ.isLoading) {
    return <div className="card-padded flex items-center gap-3 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-aurel-orange" /> Chargement du simulateur…</div>;
  }

  if (settingsQ.isError || !settingsQ.data) {
    return (
      <div className="card-padded border-red-200 bg-red-50">
        <p className="font-semibold text-red-800">Impossible de charger le lien du Live.</p>
        <button type="button" className="btn-outline mt-4" onClick={() => settingsQ.refetch()}>Réessayer</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-orange">
          <Gauge className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Outils</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink">Readiness simulator</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          Gère le seul lien YouTube utilisé par tous les boutons « retour au Live » du simulateur.
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-card border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-none" />
        <p>
          Une seule destination est active. Enregistrer un nouveau Live remplace immédiatement l'ancien lien, sans modifier ni redéployer le simulateur.
        </p>
      </div>

      <section className="card-padded space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-aurel-ink"><Youtube className="h-5 w-5 text-red-600" /> Lien du Live actif</h2>
            <p className="mt-1 text-sm text-slate-500">Public, non répertorié ou privé : colle le lien de partage YouTube exact.</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">
            <CheckCircle2 className="h-4 w-4" /> Actif
          </span>
        </div>

        <label className="block">
          <span className="label">Nouveau lien YouTube Live</span>
          <input
            className="input mt-2 min-h-12"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://www.youtube.com/live/…"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }}
          />
        </label>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" className="btn-primary min-h-12 justify-center sm:w-auto" disabled={saving || !draftUrl.trim()} onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Activation…' : isChanged ? 'Remplacer le Live actif' : 'Enregistrer le lien'}
          </button>
          <a className="btn-outline min-h-12 justify-center sm:w-auto" href={settingsQ.data.live_url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" /> Ouvrir le Live actuel
          </a>
        </div>

        <p className="break-all rounded-card-sm bg-zinc-50 p-3 font-mono text-xs text-zinc-600" dir="ltr">{settingsQ.data.live_url}</p>
        <p className="text-xs text-slate-500">Dernière mise à jour : {formatDateTime(settingsQ.data.updated_at)}</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <a className="card-padded group block" href={SIMULATOR_URL} target="_blank" rel="noreferrer">
          <div className="flex items-center justify-between gap-3">
            <div><p className="font-bold text-aurel-ink">Ouvrir le simulateur</p><p className="mt-1 text-sm text-slate-500">Teste le parcours complet sur le site public.</p></div>
            <ExternalLink className="h-5 w-5 text-aurel-orange transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </div>
        </a>
        <a className="card-padded group block" href={LIVE_REDIRECT_URL} target="_blank" rel="noreferrer">
          <div className="flex items-center justify-between gap-3">
            <div><p className="font-bold text-aurel-ink">Tester la redirection</p><p className="mt-1 text-sm text-slate-500">Doit ouvrir immédiatement le Live actif.</p></div>
            <ExternalLink className="h-5 w-5 text-aurel-orange transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </div>
        </a>
      </section>

      <p className="rounded-card border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        YouTube ouvre toujours le lien enregistré. Pour un Live privé, seuls les comptes Google autorisés par le propriétaire de la vidéo pourront le regarder.
      </p>
    </div>
  );
}
