// ============================================================================
// DISCLAIMER GATE — client-side config.
//
// Server-side constants live in migration 20260520000027 (DB is source of truth
// for security gates : DISCLAIMER_MIN_DURATION_SECONDS = 90). The min duration
// is also returned from start_disclaimer() so this file does not need to
// hardcode it. Only the video ID + display-only metadata live here.
//
// ⚠️ TODO when you upload the disclaimer to VDOCipher :
//   1. Upload the disclaimer .mp4 to your VDOCipher dashboard.
//   2. Copy the video ID (looks like `abc123def456...`).
//   3. Replace DISCLAIMER_VDOCIPHER_VIDEO_ID below with that ID.
//   4. If the video is longer/shorter than 90s, also update v_min_seconds
//      in BOTH start_disclaimer() AND acknowledge_disclaimer() in the migration
//      (then re-run the migration via Supabase SQL editor).
//   5. Commit + push. Cloudflare Pages will auto-deploy.
// ============================================================================

export const DISCLAIMER_VDOCIPHER_VIDEO_ID = ''; // ← FILL THIS AFTER UPLOAD

// Used by the page to show a placeholder while the video ID is empty.
export const DISCLAIMER_VIDEO_UPLOADED = DISCLAIMER_VDOCIPHER_VIDEO_ID.length > 0;
