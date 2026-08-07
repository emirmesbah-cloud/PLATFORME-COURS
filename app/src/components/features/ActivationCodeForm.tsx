import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, KeyRound, ArrowRight } from 'lucide-react';
import { ACTIVATION_CODE_REGEX } from '@/lib/utils';
import { INTRO_COPY } from '@/lib/activation';

/**
 * Step 1 of the activation flow: collect the code, nothing else.
 *
 * The copy here is deliberately program-neutral — we have not asked the server
 * yet, so the page must not imply Pflege or Immigration. The student is never
 * asked to pick their program: the code decides it.
 */
const codeSchema = z.object({
  // Uppercase BEFORE the regex runs. The input is visually uppercased with CSS,
  // but CSS does not change the DOM value, so a lowercase WhatsApp paste
  // ("iu-x3k7m9") used to fail the pattern silently. (SHERLOCK R14 — H2)
  code: z.string().trim().transform((s) => s.toUpperCase()).pipe(
    z.string().regex(
      ACTIVATION_CODE_REGEX,
      'Format attendu : AU-, AC-, IU- ou IC- suivi de 6 caractères',
    ),
  ),
});

export type CodeFormValues = z.infer<typeof codeSchema>;

interface Props {
  onSubmit: (values: CodeFormValues) => void;
  submitting: boolean;
  /** Message for a code the server rejected (invalid / used / revoked / pending). */
  serverError: string | null;
  defaultCode?: string;
}

export function ActivationCodeForm({ onSubmit, submitting, serverError, defaultCode }: Props) {
  const { register, handleSubmit, formState: { errors } } = useForm<CodeFormValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: defaultCode ?? '' },
  });

  return (
    <>
      <div className="mb-6 flex items-start gap-3 rounded-lg bg-aurel-orange-soft p-4 text-sm text-aurel-orange-dark">
        <KeyRound className="mt-0.5 h-5 w-5 flex-shrink-0" />
        <div>
          <div className="font-semibold">Code d’activation</div>
          <p>Il vous a été transmis par WhatsApp après votre paiement.</p>
        </div>
      </div>

      <h1 className="mb-1 text-2xl font-bold text-aurel-ink">{INTRO_COPY.title}</h1>
      <p className="mb-6 text-sm text-slate-600">{INTRO_COPY.subtitle}</p>

      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4" noValidate>
        <div>
          <label className="label" htmlFor="code">Code d’activation</label>
          <input
            id="code"
            placeholder="XX-XXXXXX"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            className="input font-mono uppercase tracking-widest"
            {...register('code')}
          />
          {errors.code && <p className="field-error">{errors.code.message}</p>}
          {!errors.code && serverError && <p className="field-error">{serverError}</p>}
        </div>

        <div className="mt-2">
          <button type="submit" disabled={submitting} className="btn-primary btn-lg btn-block">
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Vérification…</>
              : <>Continuer <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
      </form>
    </>
  );
}
