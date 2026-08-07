// ============================================================================
// Activation — program-aware helpers for the single /activate page
// ============================================================================
// ONE url (/activate) serves BOTH programs. Which program a student gets is
// decided by the SERVER from the activation code they typed — never by the
// URL, a query param, a prefix parsed here, or any other client-side signal.
//
// The `program` value that flows through this module comes back from the
// server's `check` step and is used for ONE thing only: choosing which form
// and copy to render. The enrollment itself is re-derived server-side from the
// same code row at redemption time (redeem_activation_code), so a tampered
// `program` changes what the user sees and nothing they get.
// ============================================================================

import { SUPABASE_URL_PUBLIC } from './supabase';
import type { Course, Tier } from './types';

/**
 * A program is the same identifier as the DB `course` ('pflege' | 'immigration').
 * We use the "program" vocabulary throughout the activation flow because that is
 * the word shown to students, but the two are one and the same value end to end.
 */
export type Program = Course;

/** Narrow an untrusted server value to a known program, or null. */
export function asProgram(value: unknown): Program | null {
  return value === 'immigration' || value === 'pflege' ? value : null;
}

// ── Copy ────────────────────────────────────────────────────────────────────

export interface ProgramCopy {
  /** Small badge above the form. */
  badgeTitle: string;
  badgeBody: string;
  title: string;
  subtitle: string;
  submitLabel: string;
  successToast: string;
  /** Full sentence shown on the success screen (Immigration only today). */
  successMessage: string;
  successCta: string;
  /** Where the student lands once activated. */
  destination: string;
  /** Pflege-only onboarding questions (Diplôme algérien, …). */
  showPflegeOnboarding: boolean;
  /**
   * Immigration goes through an explicit success screen with a CTA; Pflege
   * keeps its existing behaviour of redirecting straight to the dashboard.
   */
  showSuccessScreen: boolean;
}

/**
 * Step 1. Deliberately NEUTRAL — at this point the server has not yet told us
 * which program the code unlocks, so nothing here may hint at either course.
 */
export const INTRO_COPY = {
  title: 'Activez votre programme Aurel Academy',
  subtitle:
    'Entrez le code personnel reçu lors de votre inscription afin d’accéder à votre programme.',
} as const;

export const PROGRAM_COPY: Record<Program, ProgramCopy> = {
  // Pflege keeps its existing wording and its existing redirect, untouched.
  pflege: {
    badgeTitle: 'Active ton compte',
    badgeBody: 'Plus qu’une étape : crée ton compte pour accéder à ta formation Pflege.',
    title: 'Activation de ton compte',
    subtitle: 'Renseigne tes informations pour finaliser ton inscription.',
    submitLabel: 'Activer mon compte',
    successToast: 'Compte activé',
    successMessage: 'Ton accès à la formation Pflege a été activé avec succès.',
    successCta: 'Commencer la formation',
    destination: '/dashboard',
    showPflegeOnboarding: true,
    showSuccessScreen: false,
  },
  immigration: {
    badgeTitle: 'Programme Aurel Immigration',
    badgeBody: 'Votre code a été reconnu. Créez votre compte pour y accéder.',
    title: 'Activez votre programme Aurel Immigration',
    subtitle: 'Créez votre compte pour accéder directement à votre formation Immigration.',
    submitLabel: 'Activer mon accès',
    successToast: 'Accès activé',
    successMessage: 'Votre accès au programme Aurel Immigration a été activé avec succès.',
    successCta: 'Commencer la formation',
    destination: '/immigration',
    showPflegeOnboarding: false,
    showSuccessScreen: true,
  },
};

/**
 * The four code states the page must tell apart, plus the account/network
 * errors. Keys match the edge function's error strings 1:1.
 */
export const ACTIVATION_ERRORS: Record<string, string> = {
  CODE_INVALID:
    'Ce code est invalide. Vérifiez la saisie ou contactez le support.',
  CODE_ALREADY_USED:
    'Ce code a déjà été utilisé. Connectez-vous à votre compte ou contactez le support.',
  CODE_REVOKED:
    'Ce code n’est plus actif. Contactez le support.',
  CODE_PENDING:
    'Votre code est valide, mais son activation n’est pas encore disponible. Réessayez plus tard ou contactez le support.',
  CODE_UNAVAILABLE:
    'Ce code n’est pas utilisable actuellement. Contactez le support.',
  TOO_MANY_ATTEMPTS:
    'Trop de tentatives. Réessayez dans 15 minutes.',
  EMAIL_ALREADY_EXISTS:
    'Un compte existe déjà avec cet email — connectez-vous.',
  EMAIL_INVALID:      'Email invalide.',
  WEAK_PASSWORD:      'Mot de passe trop faible (min. 8 caractères).',
  MISSING_FIELDS:     'Champs requis manquants.',
  INVALID_ACTION:     'Requête invalide. Rechargez la page.',
  PAYLOAD_TOO_LARGE:  'Requête invalide. Rechargez la page.',
  REDEEM_FAILED:      'Erreur lors de l’activation. Réessayez ou contactez Aurel.',
  INTERNAL_ERROR:     'Erreur serveur. Réessayez ou contactez Aurel.',
  NETWORK_ERROR:      'Erreur réseau. Vérifiez votre connexion.',
};

/** Code states that mean "this code will never work as-is" → step 1 must own the message. */
export const TERMINAL_CODE_STATES = new Set([
  'CODE_INVALID',
  'CODE_ALREADY_USED',
  'CODE_REVOKED',
  'CODE_PENDING',
  'CODE_UNAVAILABLE',
]);

export function activationErrorMessage(error: string | undefined): string {
  return (error && ACTIVATION_ERRORS[error]) || 'Erreur inconnue. Contactez Aurel.';
}

// ── API ─────────────────────────────────────────────────────────────────────

const ACTIVATION_ENDPOINT = `${SUPABASE_URL_PUBLIC}/functions/v1/activate-account`;

interface ActivationResponse {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

async function postActivation(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<ActivationResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(ACTIVATION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return (await r.json()) as ActivationResponse;
  } finally {
    window.clearTimeout(timeout);
  }
}

export interface CheckCodeResult {
  ok: boolean;
  program?: Program;
  tier?: Tier;
  error?: string;
}

/**
 * Step 1 → 2. Ask the server which program this code unlocks.
 *
 * Read-only: nothing is created and the code is NOT consumed, so a student can
 * retry, go back, or abandon here with no consequence. A response we cannot
 * make sense of is treated as an unusable code rather than silently defaulting
 * to a program — defaulting is exactly how someone would end up in the wrong
 * course.
 */
export async function checkActivationCode(code: string): Promise<CheckCodeResult> {
  const data = await postActivation({ action: 'check', code }, 20_000);
  if (!data?.ok) return { ok: false, error: data?.error ?? 'CODE_UNAVAILABLE' };

  const program = asProgram(data.program);
  if (!program) return { ok: false, error: 'CODE_UNAVAILABLE' };

  return { ok: true, program, tier: data.tier as Tier };
}

export interface ActivateAccountInput {
  code: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  whatsapp: string;
}

export interface ActivateAccountResult {
  ok?: boolean;
  error?: string;
  user?: { id: string; email: string; tier: Tier; course: Course };
  session?: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at: number;
    token_type?: string;
  };
}

/**
 * Step 4. Creates the account and the enrollment in one server-side
 * transaction. Note that no program/course is sent: the server reads it off
 * the code row, which is the whole point.
 */
export async function activateAccount(
  input: ActivateAccountInput,
): Promise<ActivateAccountResult> {
  return (await postActivation(
    { action: 'activate', ...input },
    30_000,
  )) as ActivateAccountResult;
}
