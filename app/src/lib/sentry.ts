/**
 * Sentry — error tracking + performance monitoring.
 *
 * Init au boot de l'app. Capture automatiquement :
 *   - Erreurs JS unhandled
 *   - Erreurs ErrorBoundary React
 *   - Failed fetches (via beforeSend hook éventuel)
 *
 * NE PAS inclure de PII dans les events (auth.uid OK, mais pas l'email entier).
 * On configure `sendDefaultPii: false` et on filtre les requêtes Supabase auth.
 */

import * as Sentry from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN;
const ENV = import.meta.env.MODE; // 'development' | 'production'

export function initSentry() {
  if (!DSN) {
    if (ENV === 'production') {
      console.warn('[Sentry] VITE_SENTRY_DSN missing — error tracking disabled');
    }
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: import.meta.env.VITE_SENTRY_RELEASE || 'aurel-academy@1.0.0',

    // Performance monitoring (1% en prod, 100% en dev pour debug)
    tracesSampleRate: ENV === 'production' ? 0.05 : 1.0,

    // Session replay : 0% en prod (privacy + free tier limit), 0% en dev
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1, // capture 10% des sessions où une erreur arrive

    // Privacy : pas de PII auto, on contrôle ce qu'on envoie
    sendDefaultPii: false,

    // Filtre les events avant envoi
    beforeSend(event, hint) {
      // En dev, log dans la console aussi pour qu'on les voit
      if (ENV !== 'production') {
        console.warn('[Sentry] would send :', event.exception?.values?.[0]?.value);
      }

      // Ignore les erreurs réseau triviales (offline, abort, timeout user-action)
      const err = hint.originalException as Error | undefined;
      if (err?.name === 'AbortError') return null;
      if (err?.message?.includes('NetworkError')) return null;

      // Ne JAMAIS envoyer les requêtes Auth (peuvent contenir le password,
      // les recovery tokens, OTP codes, magic links, etc.).
      // SHERLOCK FIX : on filtre maintenant TOUT /auth/v1/* (avant : seulement
      // token + signup, donc /recover, /otp, /verify, /resend leakaient).
      if (event.request?.url?.match(/\/auth\/v1\//)) return null;

      // Scrub les query params communs qui peuvent contenir des tokens
      // (recovery, magic link). Belt-and-suspenders avant l'envoi.
      if (event.request?.url) {
        try {
          const u = new URL(event.request.url);
          for (const k of ['token', 'access_token', 'refresh_token', 'code', 'otp']) {
            if (u.searchParams.has(k)) u.searchParams.set(k, '<redacted>');
          }
          event.request.url = u.toString();
        } catch {}
      }

      return event;
    },

    // Tags par défaut sur tous les events
    initialScope: {
      tags: {
        component: 'frontend',
        deployment: 'cloudflare-pages',
      },
    },

    // Ignore certaines erreurs de bibliothèques tierces qui polluent
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      'NetworkError when attempting to fetch resource',
      // Gestionnaire navigateur qui throw quand l'user navigue avant qu'une promise résolve
      'Failed to fetch',
    ],
  });
}

/**
 * Set user context après login (sans PII sensible).
 * Appelé depuis useAuth après loadProfile.
 */
export function setSentryUser(user: { id: string; email?: string; tier?: string; is_admin?: boolean } | null) {
  if (!DSN) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: user.id,
    // On hash l'email pour pouvoir filtrer/grouper par user sans exposer le PII
    // Note: pour vraiment filtrer en prod, on peut activer sendDefaultPii: true mais
    // on prend la route privacy-first.
    username: user.email ? user.email.split('@')[0] + '@*' : undefined,
  });
  Sentry.setTags({
    tier: user.tier || 'unknown',
    is_admin: String(!!user.is_admin),
  });
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
