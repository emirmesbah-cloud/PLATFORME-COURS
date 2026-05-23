// ============================================================================
// vdocipher-otp Edge Function
//
// Generates a one-time-use OTP + playbackInfo for the VDOCipher player.
//
// Flow :
//   1. React VideoPlayer mounts with a lesson that has vdocipher_video_id.
//   2. React POSTs to this function : { video_id }.
//   3. We verify the caller is authenticated + the video belongs to a real
//      published lesson (anti-OTP-fishing).
//   4. We call VDOCipher's API with our secret API key to generate an OTP
//      with a 5-min TTL + a runtime watermark of the user's name + email.
//   5. Return { otp, playbackInfo } → React passes them to the iframe URL.
//
// Why server-side :
//   - The VDOCipher API key is secret and CAN'T be embedded in the React bundle.
//   - Per-user watermarking is added at OTP generation time, so leaked screen
//     recordings carry identification of the user that leaked them.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VDOCIPHER_API_KEY = Deno.env.get("VDOCIPHER_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (!VDOCIPHER_API_KEY) {
    console.error("[vdocipher-otp] VDOCIPHER_API_KEY env var missing");
    return json({ error: "SERVER_MISCONFIG" }, 500);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "NOT_AUTHENTICATED" }, 401);
    }

    // Service-role client with caller's JWT for auth verification + RLS-aware reads.
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "NOT_AUTHENTICATED" }, 401);
    }
    const userId = userData.user.id;

    // Parse request body.
    let body: { video_id?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "INVALID_JSON" }, 400);
    }
    const videoId = body?.video_id?.trim();
    if (!videoId || typeof videoId !== "string" || videoId.length < 10 || videoId.length > 64) {
      return json({ error: "INVALID_VIDEO_ID" }, 400);
    }

    // ANTI-OTP-FISHING : verify the video ID belongs to a real published lesson.
    // Otherwise any logged-in student could request OTPs for arbitrary VDOCipher
    // video IDs (leak-by-enumeration).
    const { data: lesson, error: lessonErr } = await supabase
      .from("lessons")
      .select("id, lesson_number, title, is_published")
      .eq("vdocipher_video_id", videoId)
      .eq("is_published", true)
      .maybeSingle();
    if (lessonErr || !lesson) {
      console.warn("[vdocipher-otp] invalid video request", { userId, videoId, err: lessonErr });
      return json({ error: "INVALID_VIDEO" }, 403);
    }

    // Profile for watermark (anti-piracy forensics).
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, email, revoked_at")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) {
      return json({ error: "NO_PROFILE" }, 403);
    }
    if (profile.revoked_at) {
      return json({ error: "ACCOUNT_REVOKED" }, 403);
    }

    const watermarkText = `${profile.first_name ?? ""} ${profile.last_name ?? ""} · ${profile.email ?? ""}`.trim();

    // Call VDOCipher to mint OTP. Docs : https://www.vdocipher.com/blog/dynamic-watermarking
    const vdoResp = await fetch(`https://dev.vdocipher.com/api/videos/${encodeURIComponent(videoId)}/otp`, {
      method: "POST",
      headers: {
        "Authorization": `Apisecret ${VDOCIPHER_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        ttl: 300, // 5 min
        annotate: JSON.stringify([
          {
            type: "rtext",
            text: watermarkText,
            alpha: "0.60",
            // FIX : VDOCipher rejects "0xFFFFFFFF" (RGBA). Only "0xFFFFFF" (RGB) is accepted.
            color: "0xFFFFFF",
            size: "15",
            interval: "5000",
          },
        ]),
      }),
    });

    if (!vdoResp.ok) {
      const errText = await vdoResp.text().catch(() => "");
      console.error("[vdocipher-otp] VDOCipher API error", vdoResp.status, errText.slice(0, 400));
      // Expose the real upstream error message to the client so we can debug
      // without server log access. Safe : it's our OWN VDOCipher errors, no
      // PII or secrets in the body.
      return json({
        error: "VDOCIPHER_FAILED",
        status: vdoResp.status,
        upstream: errText.slice(0, 200),
      }, 502);
    }

    const data = await vdoResp.json();
    if (!data?.otp || !data?.playbackInfo) {
      console.error("[vdocipher-otp] VDOCipher returned malformed payload", data);
      return json({ error: "VDOCIPHER_MALFORMED" }, 502);
    }

    return json({
      ok: true,
      otp: data.otp,
      playbackInfo: data.playbackInfo,
      // Useful for debugging which lesson was requested.
      lesson_number: lesson.lesson_number,
    });
  } catch (e) {
    console.error("[vdocipher-otp] unhandled", e);
    return json({ error: "INTERNAL" }, 500);
  }
});
