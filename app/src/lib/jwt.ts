/**
 * Lightweight JWT helpers — DECODE ONLY, no signature verification.
 *
 * Used for client-side claim inspection (`amr` for recovery sessions,
 * user_metadata for profile stub). The real security boundary is server-side
 * (Supabase verifies the JWT signature on every request); these helpers are
 * UX gating only.
 *
 * Extracted to a single file in Sherlock R3 — was previously duplicated
 * verbatim in useAuth.tsx and ResetPassword.tsx.
 */

export function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    // SHERLOCK R14 — H1 : `JSON.parse(atob(...))` casse les noms accentués
    // (« Aurélien », « Médéa », noms arabes en UTF-8) car atob retourne
    // une string où chaque caractère porte un byte (ISO-8859-1-ish), pas
    // un code-point UTF-8. JSON.parse voit alors des séquences mal
    // décodées et soit throw soit produit des Mojibake (« Ã© » au lieu
    // de « é »). On passe par TextDecoder qui décode les bytes en UTF-8.
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * True iff the access_token has `amr` claim including method='recovery'.
 * Supabase ajoute cette claim quand la session est issue d'un reset link.
 * Survit au reload (la claim est dans le JWT signé, pas un event volatile).
 */
export function jwtIsRecoverySession(accessToken: string | undefined): boolean {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return false;
  const amr = payload.amr as Array<{ method?: string } | string> | undefined;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (typeof entry === 'string') return entry === 'recovery';
    return entry?.method === 'recovery';
  });
}
