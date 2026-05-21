// ============================================================================
// SHERLOCK R14 — M3 : timing-safe string comparison for edge function secrets.
//
// Plain `===` on strings is variable-time : the JIT/engine can short-circuit
// at the first differing char, leaking the length of the matching prefix
// through observable latency. Crucial for headers we expose to the world
// (Authorization Bearer, x-cron-secret, ?token=, ?secret=) where an attacker
// can fire many probes and timing-side-channel the secret one char at a time.
//
// Implementation : compare full length and XOR-accumulate diffs. We early-fail
// only on length mismatch (length is leaked anyway via the secret format).
// ============================================================================

export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
