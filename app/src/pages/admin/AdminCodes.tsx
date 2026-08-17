import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Copy, KeyRound, MessageSquare, Search, Filter, Check, Download, Files } from 'lucide-react';
import { fetchAdminCodes, rpcAdminGenerateCodes, queryKeys } from '@/lib/queries';
import type { ActivationCode } from '@/lib/types';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { courseLabel, tierLabel, tierPrice, formatDate, formatDateTime, cn } from '@/lib/utils';
import type { Course, Tier } from '@/lib/types';
import type { ActivationDocumentMode } from '@/components/features/ActivationCodesPDF';
import { supabase } from '@/lib/supabase';

export function AdminCodes() {
  const qc = useQueryClient();
  const toast = useToast();

  const [tier, setTier] = useState<Tier>('autonome');
  const [course, setCourse] = useState<Course>('pflege');
  const [count, setCount] = useState(1);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [generated, setGenerated] = useState<string[] | null>(null);
  const [documentReferences, setDocumentReferences] = useState<Record<string, number>>({});
  const [generatedTier, setGeneratedTier] = useState<Tier>('autonome');
  const [generatedCourse, setGeneratedCourse] = useState<Course>('pflege');
  const [copyState, setCopyState] = useState<'idle' | 'codes' | 'whatsapp'>('idle');
  const [pdfBusyMode, setPdfBusyMode] = useState<ActivationDocumentMode | null>(null);

  // Filters
  const [filterCourse, setFilterCourse] = useState<'all' | Course>('all');
  const [filterTier, setFilterTier]   = useState<'all' | Tier>('all');
  const [filterUsed, setFilterUsed]   = useState<'all' | 'available' | 'used'>('all');
  const [search, setSearch]           = useState('');

  const codesQueryKey = [...queryKeys.adminCodes, filterCourse, filterTier, filterUsed, search] as const;
  const codesQ = useQuery({
    queryKey: codesQueryKey,
    queryFn: () => fetchAdminCodes({
      course: filterCourse === 'all' ? null : filterCourse,
      tier: filterTier === 'all' ? null : filterTier,
      isUsed: filterUsed === 'all' ? null : filterUsed === 'used',
      search: search.trim() || undefined,
    }),
  });

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (count < 1 || count > 500) {
      toast.error('Le nombre de codes doit être entre 1 et 500.', 'Valeur invalide');
      return;
    }
    setSubmitting(true);
    try {
      const trimmedNotes = notes.trim() || undefined;
      const r = await rpcAdminGenerateCodes({ tier, count, notes: trimmedNotes, course });
      if (!r.ok) {
        toast.error(r.error, 'Génération impossible');
        return;
      }

      // Optimistic update : prepend les nouveaux codes dans le cache directement
      // pour que le tableau historique se mette à jour INSTANT (sans refetch).
      // L'audit log est désormais inline dans la RPC (migration 011), donc plus
      // besoin d'un appel logAdminAction séparé → un round-trip réseau de moins.
      const now = new Date().toISOString();
      const optimisticCodes: ActivationCode[] = r.codes.map((code) => ({
        id: `optim-${code}-${now}`,
        code,
        tier,
        course,
        is_used: false,
        used_at: null,
        used_by_user_id: null,
        notes: trimmedNotes ?? null,
        created_at: now,
        created_by: 'admin-panel',
        document_reference_number: null,
      }));

      // Update only the visible filter result. Updating every cached filter used
      // to make Immigration codes briefly appear inside a Pflege-only view.
      const visibleInCurrentFilter =
        (filterCourse === 'all' || filterCourse === course)
        && (filterTier === 'all' || filterTier === tier)
        && filterUsed !== 'used'
        && !search.trim();
      if (visibleInCurrentFilter) {
        qc.setQueryData<ActivationCode[]>(codesQueryKey, (old) => [...optimisticCodes, ...(old ?? [])]);
      }
      qc.invalidateQueries({ queryKey: queryKeys.adminCodes });

      // Stats peuvent légèrement bouger (codes_total +N) → invalidate sans await
      qc.invalidateQueries({ queryKey: queryKeys.adminStats });

      setGenerated(r.codes);
      const { data: generatedRows, error: generatedRowsError } = await supabase
        .from('activation_codes')
        .select('code, document_reference_number')
        .in('code', r.codes);
      if (generatedRowsError) throw generatedRowsError;
      setDocumentReferences(Object.fromEntries((generatedRows ?? []).map((row) => [row.code, row.document_reference_number])));
      setGeneratedTier(tier);
      setGeneratedCourse(course);
      setNotes('');
      toast.success(`${r.codes.length} code(s) ${tierLabel(tier)} générés.`);
    } catch (err) {
      toast.error('Erreur réseau ou DB. Réessaie.', 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  function buildWhatsappMessage(codes: string[], tierLocal: Tier, courseLocal: Course) {
    const courseLine = `Cours : ${courseLabel(courseLocal)}`;
    const tierLine = `Formule : ${tierLabel(tierLocal)} (${tierPrice(tierLocal, courseLocal)})`;
    if (codes.length === 1) {
      return `🎓 Bienvenue chez Aurel Academy !

${courseLine}
${tierLine}

Voici ton code d'activation : ${codes[0]}

👉 Active ton compte ici : https://app.aurel-academy.com/activate

Tout est prêt pour toi. À bientôt !
— Aurel`;
    }
    return `🎓 Codes d'activation Aurel Academy

${courseLine}
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

  async function downloadActivationDocuments(mode: ActivationDocumentMode) {
    if (!generated?.length || pdfBusyMode) return;
    if (mode === 'full' && generatedCourse !== 'immigration') return;

    setPdfBusyMode(mode);
    try {
      // Keep the fairly large PDF renderer and QR encoder out of the initial
      // admin bundle. They are downloaded only when the admin requests a PDF.
      const [{ pdf }, QRCode, { ActivationCodesPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('qrcode'),
        import('@/components/features/ActivationCodesPDF'),
      ]);
      const qrOptions = {
        errorCorrectionLevel: 'M' as const,
        margin: 1,
        width: 320,
        color: { dark: '#101827', light: '#FFFFFF' },
      };
      const activationQr = await QRCode.toDataURL('https://app.aurel-academy.com/activate', qrOptions);
      const telegramQr = generatedCourse === 'immigration'
        ? await QRCode.toDataURL('https://t.me/+u9xT5AbqazwxODg0', qrOptions)
        : undefined;
      const blob = await pdf(
        <ActivationCodesPDF
          codes={generated}
          documentReferences={documentReferences}
          course={generatedCourse}
          tier={generatedTier}
          mode={mode}
          activationQr={activationQr}
          telegramQr={telegramQr}
        />,
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      const format = mode === 'full' ? 'dossiers-complets' : 'fiches-activation';
      anchor.href = url;
      anchor.download = `aurel-${generatedCourse}-${format}-${generated.length}-codes-${date}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      toast.success(`PDF prêt : ${generated.length} document(s).`, 'Téléchargement lancé');
    } catch (error) {
      console.error('Activation PDF generation failed', error);
      toast.error('Le PDF n’a pas pu être créé. Réessaie dans quelques secondes.', 'Erreur PDF');
    } finally {
      setPdfBusyMode(null);
    }
  }

  const codes = codesQ.data ?? [];
  const tierLabelFor = (t: string) => tierLabel(t);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-aurel-ink">Codes d'activation</h1>
        <p className="mt-1 text-slate-600">Génère les codes puis choisis : copie simple, message WhatsApp ou documents PDF prêts à imprimer.</p>
      </header>

      {/* Section générer */}
      <section className="card-padded">
        <div className="mb-5 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-aurel-orange" />
          <h2 className="text-lg font-bold text-aurel-ink">Générer de nouveaux codes</h2>
        </div>

        <form onSubmit={handleGenerate} className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-3">
            <label className="label">Cours</label>
            <div className="grid grid-cols-2 gap-2 max-w-md">
              <button type="button" onClick={() => setCourse('pflege')}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-sm font-semibold transition',
                  course === 'pflege' ? 'border-aurel-orange bg-aurel-orange-soft text-aurel-orange-dark' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                🩺 Pflege<br/><span className="text-xs font-normal">codes AU / AC</span>
              </button>
              <button type="button" onClick={() => { setCourse('immigration'); setTier('autonome'); }}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-sm font-semibold transition',
                  course === 'immigration' ? 'border-aurel-orange bg-aurel-orange-soft text-aurel-orange-dark' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                )}
              >
                ✈️ Immigration<br/><span className="text-xs font-normal">codes IU · 38 000 DA</span>
              </button>
            </div>
          </div>

          <div className="md:col-span-1">
            <label className="label">Formule</label>
            {course === 'immigration' ? (
              // Immigration : offre unique (Autonome) → un seul préfixe IU.
              <div className="rounded-lg border border-aurel-orange bg-aurel-orange-soft px-3 py-2.5 text-sm font-semibold text-aurel-orange-dark">
                Autonome<br/><span className="text-xs font-normal">38 000 DA · offre unique Immigration</span>
              </div>
            ) : (
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
            )}
          </div>

          <div>
            <label className="label">Nombre</label>
            <input type="number" min={1} max={500} value={count}
              onChange={(e) => {
                // SHERLOCK R14 — H11 : parseInt('') = NaN, parseInt('abc') = NaN.
                // Avant : NaN set dans le state, l'input affichait vide, le check
                // `count < 1 || count > 50` au submit passait sans erreur (NaN <
                // 1 = false, NaN > 50 = false) → la RPC partait avec count=NaN
                // → la RPC échouait avec INVALID_COUNT côté SQL. Maintenant
                // on clamp côté input pour rejet immédiat.
                const n = parseInt(e.target.value, 10);
                setCount(Number.isFinite(n) ? Math.max(1, Math.min(500, n)) : 1);
              }}
              className="input" />
            <p className="mt-1 text-xs text-slate-400">Entre 1 et 500 · le PDF contient automatiquement toutes les pages</p>
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
              <input className="input w-44 pl-9" placeholder="Rechercher AU-… / IU-…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select value={filterCourse} onChange={(e) => setFilterCourse(e.target.value as 'all' | Course)} className="input w-40">
              <option value="all">Tous cours</option>
              <option value="pflege">Pflege</option>
              <option value="immigration">Immigration</option>
            </select>
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
                  <th className="px-4 py-3">Cours</th>
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
                    <td className="px-4 py-3">
                      <span className={cn('badge', c.course === 'immigration' ? 'badge-teal' : 'badge-orange')}>
                        {courseLabel(c.course)}
                      </span>
                    </td>
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
        title={`${generated?.length ?? 0} code(s) ${courseLabel(generatedCourse)} prêt(s)`}
        maxWidth="max-w-xl"
      >
        {generated && (() => {
          const codesText = generated.join('\n');
          const waText = buildWhatsappMessage(generated, generatedTier, generatedCourse);
          return (
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-900 p-4 font-mono text-sm text-white">
                {generated.map((c) => <div key={c}>{c}</div>)}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button onClick={() => copyToClipboard(codesText, 'codes')} className="btn-outline">
                  {copyState === 'codes' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  Codes seuls
                </button>
                <button onClick={() => copyToClipboard(waText, 'whatsapp')} className="btn-secondary">
                  {copyState === 'whatsapp' ? <Check className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                  Message WhatsApp
                </button>
              </div>

              <div className="rounded-xl border border-aurel-orange/25 bg-aurel-orange-soft/50 p-4">
                <div className="mb-3 flex items-start gap-3">
                  <Files className="mt-0.5 h-5 w-5 flex-none text-aurel-orange" />
                  <div>
                    <h3 className="font-bold text-aurel-ink">Documents PDF</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                      Un seul fichier organisé, avec une fiche ou un dossier distinct pour chacun des {generated.length} codes.
                    </p>
                  </div>
                </div>
                <div className={cn('grid gap-2', generatedCourse === 'immigration' ? 'sm:grid-cols-2' : 'grid-cols-1')}>
                  <button
                    type="button"
                    disabled={pdfBusyMode !== null}
                    onClick={() => downloadActivationDocuments('quick')}
                    className="btn-outline bg-white"
                  >
                    {pdfBusyMode === 'quick' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Fiches rapides · 1 page/code
                  </button>
                  {generatedCourse === 'immigration' ? (
                    <button
                      type="button"
                      disabled={pdfBusyMode !== null}
                      onClick={() => downloadActivationDocuments('full')}
                      className="btn-primary"
                    >
                      {pdfBusyMode === 'full' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Dossiers complets · 4 pages/code
                    </button>
                  ) : null}
                </div>
                {generatedCourse === 'immigration' ? (
                  <p className="mt-2 text-[11px] text-slate-500">Le dossier complet reprend la fiche technique et le règlement de ton modèle d’impression.</p>
                ) : (
                  <p className="mt-2 text-[11px] text-slate-500">La fiche Pflege contient le QR d’activation, le code personnel et les instructions d’accès.</p>
                )}
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
