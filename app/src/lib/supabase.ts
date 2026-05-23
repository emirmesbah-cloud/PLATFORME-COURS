import { createClient } from '@supabase/supabase-js';
import { restoreMainFromBackupIfMissing } from './session-backup';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error(
    '[Aurel] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env.local and fill in your project credentials.'
  );
}

// SHERLOCK R16 (BULLETPROOF² — fix to R12+R15) :
// R12 and R15 prevented React state from being cleared on spurious SIGNED_OUT.
// But supabase-js ALSO clears localStorage internally when its refresh token
// flow fails. Result : user's React session survives the current page, BUT
// next refresh (F5) loads with empty localStorage → AuthGuard sees no session
// → redirects to /login. From the user's POV : "F5 logs me out".
//
// FIX : a custom storage wrapper that REFUSES to delete the auth key unless
// the deletion was explicitly initiated by the user (logout button OR realtime
// kick). All other deletion attempts — typically supabase-js auto-clearing
// during a failed refresh on slow Algerian → Supabase EU routing — are
// silently suppressed. The stale JWT stays in localStorage ; supabase-js's
// own auto-refresh will retry on next API call and either succeed (network
// recovered) or fail again (real revocation → kicked event from Realtime
// will eventually fire forceSignOut and unlock the storage).
//
// Side effect of suppressing removeItem :
//   - If the refresh_token is genuinely revoked server-side, the stale JWT
//     in localStorage will return 401 on every API call until the user's
//     Realtime channel catches up and forceSignOut fires. Worst case : a
//     few failed queries in a row. Never an unintended logout.
//   - On INTENTIONAL signOut (button click or kick), useAuth sets
//     intentionalRemoval=true before calling supabase.auth.signOut(), so
//     the wrapper allows removeItem normally.

const AUTH_KEY = 'aurel-academy-auth';

// R17 : restore main storage from backup BEFORE supabase-js initializes.
// This way, supabase-js's synchronous hydration from localStorage already
// sees the restored session. Fixes F5 logout when the main key was wiped
// by a previous failed token refresh that R16 didn't catch in time.
restoreMainFromBackupIfMissing(AUTH_KEY);

// Mutable flag shared with useAuth via the export below. Toggled true ONLY
// inside forceSignOut() / explicit signOut handlers — never reset to true
// by transient code paths.
export const intentionalRemoval = { current: false };

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
    // R16 : refuse to delete the auth key unless the deletion is intentional.
    if (k === AUTH_KEY && !intentionalRemoval.current) {
      // eslint-disable-next-line no-console
      console.warn('[Aurel R16] Suppressed auth key removeItem — session preserved across refresh');
      return;
    }
    try { window.localStorage.removeItem(k); } catch {}
    memMap.delete(k);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: safeStorage,
    storageKey: AUTH_KEY,
  },
});

export const SUPABASE_URL_PUBLIC = SUPABASE_URL;
