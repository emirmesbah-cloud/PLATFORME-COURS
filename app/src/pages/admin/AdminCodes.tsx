import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Copy, KeyRound, MessageSquare, Search, Filter, Check } from 'lucide-react';
import { fetchAdminCodes, rpcAdminGenerateCodes, queryKeys } from '@/lib/queries';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { tierLabel, tierPrice, formatDate, formatDateTime, cn } from '@/lib/utils';
import type { Tier } from '@/lib/types';

export function AdminCodes() {
  const qc = useQueryClient();
  const toast = useToast();

  const [tier, setTier] = useState<Tier>('autonome');
  const [count, setCount] = useState(1);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [generated, setGenerated] = useState<string[] | null>(null);
  const [generatedTier, setGeneratedTier] = useState<Tier>('autonome');
  const [copyState, setCopyState] = useState<'idle' | 'codes' | 'whatsapp'>('idle');

  // Filters
  const [filterTier, setFilterTier]   = useState<'all' | Tier>('all');
  const [filterUsed, setFilterUsed]   = useState<'all' | 'available' | 'used'>('all');
  const [search, setSearch]           = useState('');

  const codesQ = useQuery({
    queryKey: [...queryKeys.adminCodes, filterTier, filterUsed, search] as const,
    queryFn: () => fetchAdminCodes({
      tier: filterTier === 'all' ? null : filterTier,
      isUsed: filterUsed === 'all' ? null : filterUsed === 'used',
      search: search.trim() || undefined,
    }),
  });

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (count < 1 || count > 50) {
      toast.error('Le nombre de codes doit être entre 1 et 50.', 'Valeur invalide');
      return;
    }
    setSubmitting(true);
    try {
      const r = await rpcAdminGenerateCodes({ tier, count, notes: notes.trim() || undefined });
      if (!r.ok) {
        toast.error(r.error, 'Génération impossible');
        return;
      }
      setGenerated(r.codes);
      setGeneratedTier(tier);
      setNotes('');
      toast.success(`${r.codes.length} code(s) ${tierLabel(tier)} générés.`);
      qc.invalidateQueries({ queryKey: queryKeys.adminCodes });
      qc.invalidateQueries({ queryKey: queryKeys.adminStats });
    } catch (err) {
      toast.error('Erreur réseau ou DB. Réessaie.', 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  function buildWhatsappMessage(codes: string[], tierLocal: Tier) {
    const tierLine = `Formule : ${tierLabel(tierLocal)} (${tierPrice(tierLocal)})`;
    if (codes.length === 1) {
      return `🎓 Bienvenue chez Aurel Academy !

${tierLine}

Voici ton code d'activation : ${codes[0]}

👉 Active ton compte ici : https://app.aurel-academy.com/activate

Tout est prêt pour toi. À bientôt !
— Aurel`;
    }
    return `🎓 Codes d'activation Aurel Academy

${tierLine}

${codes.map((c) => `• ${c}`).join('\n')}

👉 Activation : https://app.aurel-academy.com/activate

— Aurel`;
  }

  async function copyToClipboard(text: string, kind: 'codes' | 'whatsapp') {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(kind);
      setTimeout(() => setCopyState('idle'), 2000);
      toast.success('Copié dans le presse-papier.');
    } catch {
      toast.error('Impossible de copier. Sélectionne et copie manuellement.', 'Erreur');
    }
  }

  const codes = codesQ.data ?? [];
  const tierLabelFor = (t: string) => tierLabel(t);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink">Codes d'activation</h1>
        <p className="mt-1 text-slate-600">Génère et envoie les codes par WhatsApp après paiement.</p>
      </header>

      {/* Section générer */}
      <section className="card-padded">
        <div className="mb-5 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-aurel-orange" />
          <h2 className="text-lg font-bold text-aurel-ink">Générer de nouveaux codes</h2>
        </div>

        <form onSubmit={handleGenerate} className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-1">
            <label className="label">Formule</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setTier('autonome')}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-sm font-semibold transition',
                  tier === 'autonome' ? 'border-aurel-orange bg-aurel-orange-soft text-aurel-orange-dark' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                Autonome<br/><span className="text-xs font-normal">12 900 DA</span>
              </button>
              <button type="button" onClick={() => setTier('accompagne')}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-sm font-semibold transition',
                  tier === 'accompagne' ? 'border-aurel-teal bg-teal-50 text-aurel-teal' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                Accompagné<br/><span className="text-xs font-normal">42 800 DA</span>
              </button>
            </div>
          </div>

          <div>
            <label className="label">Nombre</label>
            <input type="number" min={1} max={50} value={count}
              onChange={(e) => setCount(parseInt(e.target.value || '1', 10))}
              className="input" />
            <p className="mt-1 text-xs text-slate-400">Entre 1 et 50</p>
          </div>

          <div className="md:col-span-1">
            <label className="label">Notes (optionnel)</label>
            <input type="text" placeholder="Ex : Promo lancement, ou nom du client"
              value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
          </div>

          <div className="md:col-span-3">
            <button type="submit" disabled={submitting} className="btn-primary btn-lg">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Générer {count} code{count > 1 ? 's' : ''}
            </button>
          </div>
        </form>
      </section>

      {/* Section historique */}
      <section className="card">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-bold text-aurel-ink">Historique ({codes.length})</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input className="input w-44 pl-9" placeholder="Rechercher AU-..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select value={filterTier} onChange={(e) => setFilterTier(e.target.value as 'all' | Tier)} className="input w-36">
              <option value="all">Tous tiers</option>
              <option value="autonome">Autonome</option>
              <option value="accompagne">Accompagné</option>
            </select>
            <select value={filterUsed} onChange={(e) => setFilterUsed(e.target.value as 'all' | 'available' | 'used')} className="input w-44">
              <option value="all">Tous statuts</option>
              <option value="available">Disponibles</option>
              <option value="used">Utilisés</option>
            </select>
          </div>
        </div>

        {codesQ.isLoading ? (
          <Spinner label="Chargement..." />
        ) : codes.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Filter className="mx-auto mb-2 h-8 w-8 opacity-30" />
            Aucun code ne correspond.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Formule</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3">Créé le</th>
                  <th className="px-4 py-3">Utilisé le</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {codes.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-aurel-ink">{c.code}</td>
                    <td className="px-4 py-3"><span className="badge badge-orange">{tierLabelFor(c.tier)}</span></td>
                    <td className="px-4 py-3">
                      {c.is_used
                        ? <span className="badge badge-slate">Utilisé</span>
                        : <span className="badge badge-green">Disponible</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(c.used_at)}</td>
                    <td className="px-4 py-3 text-slate-500">{c.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal codes générés */}
      <Modal
        open={!!generated}
        onClose={() => setGenerated(null)}
        title={`${generated?.length ?? 0} code(s) ${tierLabel(generatedTier)} prêt(s)`}
        maxWidth="max-w-xl"
      >
        {generated && (() => {
          const codesText = generated.join('\n');
          const waText = buildWhatsappMessage(generated, generatedTier);
          return (
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-900 p-4 font-mono text-sm text-white">
                {generated.map((c) => <div key={c}>{c}</div>)}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button onClick={() => copyToClipboard(codesText, 'codes')} className="btn-outline">
                  {copyState === 'codes' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  Copier les codes
                </button>
                <button onClick={() => copyToClipboard(waText, 'whatsapp')} className="btn-secondary">
                  {copyState === 'whatsapp' ? <Check className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                  Copier message WhatsApp
                </button>
              </div>

              <details className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600">
                <summary className="cursor-pointer font-semibold text-aurel-ink">Aperçu du message WhatsApp</summary>
                <pre className="mt-3 whitespace-pre-wrap font-sans text-xs text-slate-600">{waText}</pre>
              </details>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
