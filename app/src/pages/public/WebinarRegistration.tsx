import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { AurelLogo } from '@/components/features/AurelLogo';
import {
  fetchPublicEcomCommunes, fetchPublicEcomWilayas, fetchWebinarFormSettings, queryKeys, submitWebinarLead,
} from '@/lib/queries';
import { trackEvent } from '@/lib/pixel';

type FormState = {
  fullName: string;
  phone: string;
  email: string;
  attended: boolean | null;
  wilayaId: number;
  commune: string;
  address: string;
  extraAnswers: Record<string, string>;
  website: string;
};

const EMPTY_FORM: FormState = {
  fullName: '', phone: '', email: '', attended: null,
  wilayaId: 0, commune: '', address: '', extraAnswers: {}, website: '',
};

const ERRORS: Record<string, string> = {
  NAME_REQUIRED: 'Entre ton nom complet.',
  PHONE_INVALID: 'Entre un numéro WhatsApp algérien valide, par exemple 0555123456.',
  EMAIL_INVALID: 'Entre une adresse email valide.',
  WILAYA_INVALID: 'Choisis ta wilaya.',
  COMMUNE_INVALID: 'Choisis une commune livrable dans la liste.',
  CATALOG_UNAVAILABLE: 'Les communes sont temporairement indisponibles. Réessaie dans un instant.',
  ADDRESS_REQUIRED: 'Entre ta commune et ton adresse de livraison.',
  RATE_LIMITED: 'Trop de tentatives. Réessaie dans une heure.',
  SUBMISSION_FAILED: "L'inscription n'a pas pu être enregistrée. Réessaie dans un instant.",
};

export function WebinarRegistrationPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const wilayasQ = useQuery({
    queryKey: queryKeys.publicEcomWilayas,
    queryFn: fetchPublicEcomWilayas,
    staleTime: 24 * 60 * 60_000,
    retry: 2,
  });
  const settingsQ = useQuery({
    queryKey: [...queryKeys.webinarFormSettings, 'public'],
    queryFn: () => fetchWebinarFormSettings(true),
    staleTime: 60_000,
  });
  const settings = settingsQ.data;
  const communesQ = useQuery({
    queryKey: queryKeys.publicEcomCommunes(form.wilayaId),
    queryFn: () => fetchPublicEcomCommunes(form.wilayaId),
    enabled: form.wilayaId > 0,
    staleTime: 24 * 60 * 60_000,
    retry: 2,
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!form.fullName.trim() || !form.phone.trim() || !form.email.trim()
      || form.attended === null || !form.wilayaId || !form.commune.trim() || !form.address.trim()) {
      setError('Remplis tous les champs obligatoires.');
      return;
    }
    const wilaya = wilayasQ.data?.find((item) => item.id === form.wilayaId);
    if (!wilaya) { setError('Choisis ta wilaya.'); return; }
    const commune = communesQ.data?.find((item) => item.commune === form.commune && item.livrable);
    if (!commune) { setError('Choisis une commune livrable dans la liste.'); return; }

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await submitWebinarLead({
        full_name: form.fullName,
        phone: form.phone,
        email: form.email,
        attended_live: form.attended,
        wilaya_id: wilaya.id,
        wilaya_name: wilaya.libelle,
        commune: commune.commune,
        address: form.address,
        website: form.website,
        extra_answers: form.extraAnswers,
      });
      trackEvent('Lead', { content_name: 'Inscription après webinar', content_category: 'Webinar' });
      setSuccess(true);
    } catch (submissionError) {
      const code = submissionError instanceof Error ? submissionError.message : 'SUBMISSION_FAILED';
      setError(ERRORS[code] ?? ERRORS.SUBMISSION_FAILED);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <main className="grid min-h-screen place-items-center bg-zinc-50 px-4 py-10">
        <section className="card max-w-lg p-8 text-center md:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-green-50 text-green-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight text-zinc-950">Merci pour ta réponse</h1>
          <p className="mt-3 leading-relaxed text-zinc-600">
            Merci {form.fullName.split(' ')[0]}. Notre équipe pourra maintenant te contacter pour finaliser ta demande.
          </p>
          <div className="mt-6 rounded-card-sm bg-aurel-orange-soft p-4 text-sm text-aurel-orange-dark">Garde ton téléphone et WhatsApp disponibles pour notre équipe.</div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-xl px-4 py-7 md:py-10">
        <AurelLogo className="justify-center" />
        <section className="card mt-7 overflow-hidden">
          <form onSubmit={submit} className="space-y-8 p-6 md:p-8">
            {(settings?.sections ?? []).map((section) => <div key={section.id} className="rounded-card-sm bg-aurel-orange-soft p-4"><div className="font-semibold text-aurel-orange-dark">{section.title}</div>{section.description && <p className="mt-1 text-sm text-zinc-600">{section.description}</p>}</div>)}
            <div className="space-y-6">
              <Field label="Nom complet *"><input className="input" autoComplete="name" maxLength={100} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder="Ton nom et prénom" /></Field>
              <Field label="Numéro WhatsApp *"><input className="input" inputMode="tel" autoComplete="tel" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0555123456" /></Field>
              <Field label="Adresse email *"><input className="input" type="email" autoComplete="email" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nom@gmail.com" /></Field>
              <Field label="Wilaya de livraison *">
                <select className="input" value={form.wilayaId}
                  onChange={(e) => setForm({ ...form, wilayaId: Number(e.target.value), commune: '' })}
                  disabled={wilayasQ.isLoading || wilayasQ.isError}>
                  <option value={0}>{wilayasQ.isLoading ? 'Chargement des wilayas…' : wilayasQ.isError ? 'Wilayas indisponibles' : 'Choisir la wilaya'}</option>
                  {(wilayasQ.data ?? []).map((wilaya) => <option key={wilaya.id} value={wilaya.id}>{wilaya.id.toString().padStart(2, '0')} — {wilaya.libelle}</option>)}
                </select>
              </Field>
              <Field label="Commune de livraison *">
                <select className="input" value={form.commune}
                  onChange={(e) => setForm({ ...form, commune: e.target.value })}
                  disabled={!form.wilayaId || communesQ.isLoading || communesQ.isError}>
                  <option value="">{!form.wilayaId ? "Choisis d'abord la wilaya" : communesQ.isLoading ? 'Chargement des communes…' : communesQ.isError ? 'Communes indisponibles' : 'Choisir la commune'}</option>
                  {(communesQ.data ?? []).map((item) => <option key={item.id} value={item.commune}>{item.commune}</option>)}
                </select>
              </Field>
              <Field label="Adresse de livraison *"><input className="input" autoComplete="street-address" maxLength={200} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Quartier, rue, repère…" /></Field>
            </div>

            <fieldset>
              <legend className="label">As-tu vu le webinar de ce soir ? *</legend>
              <div className="space-y-2">
                <AttendanceChoice checked={form.attended === true} label="Oui, j'ai vu le webinar" onClick={() => setForm({ ...form, attended: true })} />
                <AttendanceChoice checked={form.attended === false} label="Non, pas encore" onClick={() => setForm({ ...form, attended: false })} />
              </div>
            </fieldset>

            {(settings?.extra_fields ?? []).length > 0 && <div className="space-y-6 border-t border-zinc-100 pt-7">{settings!.extra_fields.map((field) => <Field key={field.id} label={`${field.label}${field.required ? ' *' : ''}`}>{field.type === 'textarea' ? <textarea className="input min-h-24" required={field.required} value={form.extraAnswers[field.id] ?? ''} onChange={(e) => setForm({ ...form, extraAnswers: { ...form.extraAnswers, [field.id]: e.target.value } })} /> : field.type === 'select' ? <select className="input" required={field.required} value={form.extraAnswers[field.id] ?? ''} onChange={(e) => setForm({ ...form, extraAnswers: { ...form.extraAnswers, [field.id]: e.target.value } })}><option value="">Choisir</option>{(field.options ?? []).map((option) => <option key={option}>{option}</option>)}</select> : <input className="input" required={field.required} value={form.extraAnswers[field.id] ?? ''} onChange={(e) => setForm({ ...form, extraAnswers: { ...form.extraAnswers, [field.id]: e.target.value } })} />}</Field>)}</div>}

            <div className="absolute -left-[9999px]" aria-hidden="true">
              <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
            </div>

            {error && <div role="alert" className="rounded-card-sm border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

            <button type="submit" className="btn-primary btn-lg btn-block min-h-[50px]" disabled={submitting}>
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              {submitting ? 'Enregistrement…' : 'Envoyer ma demande'}
            </button>
            <p className="flex items-center justify-center gap-2 text-center text-xs text-zinc-500">
              <ShieldCheck className="h-4 w-4 text-aurel-teal" /> Tes informations restent privées et utilisées uniquement pour ton suivi Aurel Academy.
            </p>
          </form>
        </section>
        <p className="mt-5 text-center text-xs text-zinc-400">© 2026 Aurel Academy</p>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-2"><span className="label">{label}</span>{children}</label>;
}

function AttendanceChoice({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onClick}
      className={`min-h-[48px] rounded-card-sm border px-4 py-3 text-left text-sm font-semibold transition-colors ${checked ? 'border-aurel-orange bg-aurel-orange-soft text-aurel-orange-dark' : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'}`}>
      <span className={`mr-2 inline-block h-3 w-3 rounded-full border ${checked ? 'border-aurel-orange bg-aurel-orange' : 'border-zinc-400'}`} />
      {label}
    </button>
  );
}
