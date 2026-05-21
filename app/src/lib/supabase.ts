import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.error(
    '[Aurel] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env.local and fill in your project credentials.'
  );
}

// SHERLOCK R14 — M8 : storage wrapper qui fallback en mémoire quand
// localStorage throw (Safari Private Browsing pre-15.4 throws QuotaExceeded
// on ANY setItem call ; certains corporate Firefox bloquent aussi). Sans ce
// fallback, supabase-js peut hang sur persistSession + crash au boot →
// l'app est cassée pour ces users sans aucun feedback. Avec le fallback,
// la session vit pour la durée du tab (perdue au refresh, accepté).
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

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: safeStorage,
    storageKey: 'aurel-academy-auth',
  },
});

export const SUPABASE_URL_PUBLIC = SUPABASE_URL;
