import { createClient } from '@supabase/supabase-js';
import { clearSessionBackup } from './session-backup';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const RECOVERY_SESSION_KEY = 'aurel:password-recovery-session';

type RememberedRecoverySession = {
  userId: string;
  expiresAt: number;
};

function tokenIdentity(accessToken: string): { userId: string; expiresAt: number } | null {
  try {
    const part = accessToken.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { sub?: string; exp?: number };
    if (!payload.sub || typeof payload.exp !== 'number') return null;
    return { userId: payload.sub, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
}

export function rememberPasswordRecoverySession(accessToken: string): void {
  const identity = tokenIdentity(accessToken);
  if (!identity || identity.expiresAt <= Date.now()) return;
  try {
    window.sessionStorage.setItem(
      RECOVERY_SESSION_KEY,
      JSON.stringify(identity satisfies RememberedRecoverySession),
    );
  } catch {
    // PASSWORD_RECOVERY remains the fallback when sessionStorage is unavailable.
  }
}

export function isRememberedPasswordRecoverySession(accessToken: string | undefined): boolean {
  if (!accessToken) return false;
  try {
    const identity = tokenIdentity(accessToken);
    if (!identity) return false;
    const raw = window.sessionStorage.getItem(RECOVERY_SESSION_KEY);
    if (!raw) return false;
    const remembered = JSON.parse(raw) as Partial<RememberedRecoverySession>;
    if (
      remembered.userId !== identity.userId ||
      typeof remembered.expiresAt !== 'number' ||
      remembered.expiresAt <= Date.now()
    ) {
      window.sessionStorage.removeItem(RECOVERY_SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function clearPasswordRecoverySession(): void {
  try { window.sessionStorage.removeItem(RECOVERY_SESSION_KEY); } catch {}
}

// Capture the implicit-flow recovery identity synchronously, before
// createClient() initializes and removes the URL fragment. We remember the
// user id (not the raw token), so a legitimate token refresh while the reset
// form is open does not make the link appear expired.
if (/\/reset-password\/?$/.test(window.location.pathname) && window.location.hash.length > 1) {
  const recoveryParams = new URLSearchParams(window.location.hash.slice(1));
  if (recoveryParams.get('type') === 'recovery') {
    const recoveryAccessToken = recoveryParams.get('access_token');
    if (recoveryAccessToken) rememberPasswordRecoverySession(recoveryAccessToken);
  }
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error(
    '[Aurel] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env.local and fill in your project credentials.'
  );
}

const AUTH_KEY = 'aurel-academy-auth';

// Remove the legacy duplicate refresh-token backup. Supabase owns the auth
// lifecycle now; resurrecting a server-revoked session caused repeated 401s
// and made valid users look logged in while every protected request failed.
clearSessionBackup();

// SHERLOCK R14 — M8 : fallback en mémoire si localStorage throw (Safari Private
// Browsing pre-15.4 throws QuotaExceeded on ANY setItem call ; certains
// corporate Firefox bloquent aussi). Sans ce fallback, supabase-js peut hang
// sur persistSession + crash au boot. Avec le fallback, la session vit pour
// la durée du tab (perdue au refresh, accepté).
const memMap = new Map<string, string>();
const safeStorage = {
  getItem(k: string): string | null {
    try { return window.localStorage.getItem(k); }
    catch { return memMap.get(k) ?? null; }
  },
  setItem(k: string, v: string): void {
    try { window.localStorage.setItem(k, v); }
    catch { memMap.set(k, v); }
  },
  removeItem(k: string): void {
    try { window.localStorage.removeItem(k); } catch {}
    memMap.delete(k);
  },
};

// A dead mobile connection must not leave auth/profile requests pending
// forever. Respect a caller-provided AbortSignal and add a 30s ceiling for
// every Supabase request (Auth, REST, RPC and Storage).
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const upstream = init.signal;
  const forwardAbort = () => controller.abort();
  if (upstream) {
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    upstream?.removeEventListener('abort', forwardAbort);
  }
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: safeStorage,
    storageKey: AUTH_KEY,
  },
  global: {
    fetch: fetchWithTimeout,
  },
});

export const SUPABASE_URL_PUBLIC = SUPABASE_URL;
