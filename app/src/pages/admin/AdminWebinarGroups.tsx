import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, MessageCircle, Save, ShieldCheck } from 'lucide-react';
import { fetchWebinarGroups, queryKeys, updateWebinarGroup } from '@/lib/queries';
import { useToast } from '@/components/ui/Toast';
import { formatDateTime } from '@/lib/utils';
import type { WebinarGroup, WebinarGroupSlug } from '@/lib/types';

const GROUP_META: Record<WebinarGroupSlug, { title: string; pageUrl: string; description: string }> = {
  immigration: {
    title: 'Webinar Immigration',
    pageUrl: 'https://aurel-academy.com/immigration/webinar/',
    description: 'Lien utilisé par le bouton du webinar Immigration Allemagne.',
  },
  pflege: {
    title: 'Webinar Pflege',
    pageUrl: 'https://aurel-academy.com/pflege/webinar/',
    description: "Lien utilisé après l'inscription au webinar Pflege.",
  },
  tiktok: {
    title: 'Campagne TikTok',
    pageUrl: 'https://aurel-academy.com/webinartk/',
    description: 'Lien utilisé par la landing page des publicités TikTok.',
  },
};

function parseWhatsAppGroupCode(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'chat.whatsapp.com') return null;
    const code = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return /^[A-Za-z0-9_-]{10,100}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function AdminWebinarGroups() {
  const groupsQ = useQuery({
    queryKey: queryKeys.adminWebinarGroups,
    queryFn: fetchWebinarGroups,
  });

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-orange">
          <MessageCircle className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Webinars</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink">Groupes WhatsApp</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          Colle le nouveau lien d'invitation puis enregistre. Le bouton du webinar utilisera le nouveau groupe automatiquement.
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-card border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-none" />
        <p>Cette page est réservée aux administrateurs. Chaque modification est enregistrée dans le journal d'audit.</p>
      </div>

      {groupsQ.isLoading && (
        <div className="card-padded flex items-center gap-3 text-sm text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin text-aurel-orange" /> Chargement des groupes…
        </div>
      )}

      {groupsQ.isError && (
        <div className="card-padded border-red-200 bg-red-50">
          <p className="font-semibold text-red-800">Impossible de charger les groupes.</p>
          <p className="mt-1 text-sm text-red-700">Vérifie la connexion puis réessaie.</p>
          <button type="button" className="btn-outline mt-4" onClick={() => groupsQ.refetch()}>Réessayer</button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {(groupsQ.data ?? []).map((group) => <GroupCard key={group.slug} group={group} />)}
      </div>
    </div>
  );
}

function GroupCard({ group }: { group: WebinarGroup }) {
  const qc = useQueryClient();
  const toast = useToast();
  const meta = GROUP_META[group.slug];
  const currentUrl = `https://chat.whatsapp.com/${group.whatsapp_group_code}`;
  const [input, setInput] = useState(currentUrl);
  const [saving, setSaving] = useState(false);
  const parsedCode = parseWhatsAppGroupCode(input);
  const changed = parsedCode !== null && parsedCode !== group.whatsapp_group_code;

  useEffect(() => setInput(currentUrl), [currentUrl]);

  async function save() {
    if (!parsedCode) {
      toast.error('Colle un lien qui commence par https://chat.whatsapp.com/', 'Lien invalide');
      return;
    }
    if (!changed || saving) return;

    setSaving(true);
    try {
      await updateWebinarGroup(group.slug, parsedCode);
      await qc.invalidateQueries({ queryKey: queryKeys.adminWebinarGroups });
      toast.success(`Le groupe ${meta.title} a été mis à jour.`, 'Lien enregistré');
    } catch {
      toast.error("La modification n'a pas été enregistrée. Réessaie.", 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card-padded space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">{meta.title}</h2>
          <p className="mt-1 text-sm text-zinc-600">{meta.description}</p>
        </div>
        <span className="badge-green"><span className="dot" /> Actif</span>
      </div>

      <div>
        <label className="label" htmlFor={`group-${group.slug}`}>Nouveau lien du groupe WhatsApp</label>
        <input
          id={`group-${group.slug}`}
          className="input font-mono"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="https://chat.whatsapp.com/..."
        />
        {input.trim() && !parsedCode && (
          <p className="field-error">Ce lien WhatsApp n'est pas valide.</p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn-primary flex-1" disabled={!changed || saving} onClick={save}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Enregistrement…' : 'Enregistrer le nouveau lien'}
        </button>
        <a className="btn-outline" href={meta.pageUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" /> Voir la page
        </a>
      </div>

      <div className="border-t border-zinc-100 pt-4 text-xs text-zinc-500">
        Dernière mise à jour : {formatDateTime(group.updated_at)}
      </div>
    </section>
  );
}
