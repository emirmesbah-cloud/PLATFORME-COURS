// ============================================================================
// Aurel Academy — Sentry helper pour edge functions Deno
//
// Wrapper léger autour de l'API Sentry Envelope (pas de SDK npm car Deno).
// On poste les events directement à l'endpoint Sentry via fetch.
//
// Usage :
//   import { reportError } from '../_shared/sentry.ts';
//   try { ... } catch (e) {
//     await reportError(e, { function: 'activate-account', extra: {...} });
//     return new Response(...);
//   }
//
// Variables d'env requises (Supabase Vault) :
//   SENTRY_DSN            — DSN public du projet Sentry edge functions
//   SUPABASE_REGION       — auto-injectée par Supabase
// ============================================================================

const DSN = Deno.env.get('SENTRY_DSN') || '';

interface SentryOptions {
  function?: string;     // nom de l'edge function (activate-account, etc.)
  user_id?: string;      // auth.uid si dispo (jamais l'email)
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  level?: 'fatal' | 'error' | 'warning' | 'info';
}

function parseDsn(dsn: string) {
  // DSN format : https://<key>@<host>/<projectId>
  const m = dsn.match(/^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!m) throw new Error('Invalid Sentry DSN');
  return {
    protocol: m[1],
    publicKey: m[2],
    host: m[3],
    projectId: m[4],
  };
}

/**
 * Envoie une erreur à Sentry. Best-effort, ne throw jamais (on swallow).
 */
export async function reportError(error: unknown, opts: SentryOptions = {}): Promise<void> {
  if (!DSN) return; // disabled — pas de DSN configuré

  try {
    const { protocol, publicKey, host, projectId } = parseDsn(DSN);
    const url = `${protocol}://${host}/api/${projectId}/store/`;

    const err = error instanceof Error ? error : new Error(String(error));
    const stack = err.stack ? err.stack.split('\n').slice(0, 30).join('\n') : '';

    const event = {
      event_id: crypto.randomUUID().replace(/-/g, ''),
      timestamp: new Date().toISOString(),
      platform: 'javascript',
      level: opts.level || 'error',
      logger: 'edge-function',
      environment: 'production',
      release: 'aurel-academy@1.0.0',
      server_name: opts.function || 'unknown',
      tags: {
        component: 'edge-function',
        runtime: 'deno',
        ...(opts.tags || {}),
      },
      user: opts.user_id ? { id: opts.user_id } : undefined,
      extra: opts.extra,
      exception: {
        values: [{
          type: err.name || 'Error',
          value: err.message,
          stacktrace: stack ? {
            frames: parseStack(stack),
          } : undefined,
        }],
      },
    };

    // Sentry-Auth header avec le public key
    const authHeader = [
      'Sentry sentry_version=7',
      'sentry_client=aurel-edge/1.0',
      `sentry_key=${publicKey}`,
    ].join(', ');

    // Best-effort, timeout 3s pour pas bloquer la response user
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);

    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': authHeader,
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });

    clearTimeout(t);
  } catch (e) {
    // Never let Sentry errors break the actual function. Log only.
    console.error('[Sentry] reportError failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * Parse une stack trace style V8 en frames Sentry.
 * Best-effort : si parse échoue, retourne une frame avec le raw text.
 */
function parseStack(stack: string): Array<{ filename: string; function: string; lineno?: number; colno?: number }> {
  const lines = stack.split('\n').filter(l => l.trim().startsWith('at '));
  const frames: Array<{ filename: string; function: string; lineno?: number; colno?: number }> = [];

  for (const line of lines) {
    // Format : at functionName (filename:line:col)  ou  at filename:line:col
    const m1 = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
    const m2 = line.match(/at\s+(.+?):(\d+):(\d+)/);
    if (m1) {
      frames.push({ function: m1[1], filename: m1[2], lineno: parseInt(m1[3], 10), colno: parseInt(m1[4], 10) });
    } else if (m2) {
      frames.push({ function: '?', filename: m2[1], lineno: parseInt(m2[2], 10), colno: parseInt(m2[3], 10) });
    }
  }

  // Sentry attend les frames "newest last"
  return frames.reverse();
}

/**
 * Helper pour wrapper un handler avec capture auto.
 * Usage :
 *   serve(withSentry('activate-account', async (req) => { ... }));
 */
export function withSentry<T extends (req: Request) => Promise<Response>>(
  functionName: string,
  handler: T,
): T {
  return (async (req: Request) => {
    try {
      return await handler(req);
    } catch (e) {
      await reportError(e, { function: functionName, level: 'error' });
      return new Response(
        JSON.stringify({ ok: false, error: 'INTERNAL_ERROR' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }) as T;
}
