// ============================================================================
// SESSION BACKUP — belt-and-suspenders persistence on top of supabase-js storage.
//
// Why :
// Even with R16 suppressing removeItem on the main auth key, F5 still logs
// out some users (slow Algerian ISP edge cases ; supabase-js may write a
// session with status that on rehydrate it considers invalid ; or service
// worker shenanigans). To bulletproof the experience, we keep an INDEPENDENT
// copy of the session under a key supabase-js doesn't touch.
//
// On bootstrap, useAuth reads BOTH the main supabase-js key AND this backup.
// If the main key is missing/corrupted but the backup has a valid session,
// we restore the main key from backup, then proceed normally.
//
// The backup is ONLY cleared on intentional signOut (logout button OR realtime
// kick). Token refresh failures, network blips, and supabase-js internal
// auto-clear cannot touch it.
// ============================================================================

import type { Session } from '@supabase/supabase-js';

const BACKUP_KEY = 'aurel-academy-session-backup';

export interface BackupPayload {
  session: Session;
  savedAt: number;
}

/** Write the current session to the backup key. Idempotent + safe to call often. */
export function writeSessionBackup(session: Session | null): void {
  try {
    if (!session?.access_token || !session?.refresh_token) {
      // Nothing useful to back up — leave previous backup alone.
      return;
    }
    const payload: BackupPayload = { session, savedAt: Date.now() };
    localStorage.setItem(BACKUP_KEY, JSON.stringify(payload));
  } catch {
    // Safari Private / quota exceeded → silently fail. Main flow continues.
  }
}

/** Read the backup session. Returns null if not present or expired. */
export function readSessionBackup(): Session | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed: BackupPayload = JSON.parse(raw);
    if (!parsed?.session?.access_token || !parsed?.session?.refresh_token) return null;
    // Backup older than 30 days = ignore (refresh token in supabase has shorter
    // life anyway). Avoids restoring a zombie session after long idle.
    const ageMs = Date.now() - (parsed.savedAt ?? 0);
    if (ageMs > 30 * 24 * 60 * 60 * 1000) return null;
    return parsed.session;
  } catch {
    return null;
  }
}

/** Clear the backup. Call on INTENTIONAL signOut only. */
export function clearSessionBackup(): void {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {}
}

/**
 * Restore the main supabase-js storage key from the backup IF the main key
 * is missing or unparseable. Called once on bootstrap, before supabase-js
 * hydrates. Returns true if a restore happened.
 *
 * The main key is `aurel-academy-auth` (configured in lib/supabase.ts).
 * supabase-js expects a JSON-serialized object with the session fields ;
 * different versions wrap it differently. To be safe, we write BOTH formats :
 *   1. Top-level Session object (newest supabase-js).
 *   2. { currentSession, expiresAt } wrapper (older versions, which our
 *      own bootstrap code also handles).
 */
export function restoreMainFromBackupIfMissing(mainKey: string): boolean {
  try {
    const existing = localStorage.getItem(mainKey);
    // If existing has access_token (any wrapper level), it's already populated.
    if (existing) {
      try {
        const p = JSON.parse(existing);
        if (
          p?.access_token ||
          p?.currentSession?.access_token ||
          p?.session?.access_token
        ) {
          return false; // Main key already has a session — no restore needed.
        }
      } catch {}
    }
    const backup = readSessionBackup();
    if (!backup) return false;
    // Write both formats so whichever supabase-js version reads it works.
    const payload = {
      ...backup,
      // Wrapper format for backward compat with our bootstrap code.
      currentSession: backup,
      expiresAt: backup.expires_at,
    };
    localStorage.setItem(mainKey, JSON.stringify(payload));
    // eslint-disable-next-line no-console
    console.info('[Aurel R17] Restored main auth key from session backup');
    return true;
  } catch {
    return false;
  }
}
