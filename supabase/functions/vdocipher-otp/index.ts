// ============================================================================
// vdocipher-otp Edge Function
//
// Generates a one-time-use OTP + playbackInfo for the VDOCipher player.
//
// Flow :
//   1. React VideoPlayer mounts with a lesson that has vdocipher_video_id.
//   2. React POSTs to this function : { video_id }.
//   3. We verify the caller is authenticated + the video belongs to a real
//      lesson. Students require a published lesson; admins may preview drafts.
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

// The two courses live in SEPARATE VDOCipher accounts, each with its own API
// secret. Pflege → VDOCIPHER_API_KEY ; Immigration → VDOCIPHER_API_KEY_IMMIGRATION.
// A key can only mint OTPs for videos in its own account, so we must pick the
// right one per requested video (see course routing below).
const VDOCIPHER_API_KEY = Deno.env.get("VDOCIPHER_API_KEY") ?? "";
const VDOCIPHER_API_KEY_IMMIGRATION = Deno.env.get("VDOCIPHER_API_KEY_IMMIGRATION") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// SHERLOCK R22 : strict CORS — match the pattern used by admin-purge-user
// and other sensitive functions. Was '*' previously which let any origin
// proxy OTP requests with a stolen JWT.
const ALLOWED_ORIGINS = new Set<string>([
  "https://app.aurel-academy.com",
  "https://aurel-academy.com",
  "http://localhost:5173",
  "http://localhost:4173",
]);

function buildCors(origin: string | null): Record<string, string> {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://app.aurel-academy.com";
  return {
    "Access-Control-Allow-Origin":  allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary":                         "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCors(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCors(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);
  }
  // Note : we DON'T check key presence up front anymore — the required key
  // depends on which course the video belongs to (resolved below), so a missing
  // Immigration key must never break Pflege playback and vice-versa.

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "NOT_AUTHENTICATED" }, 401, origin);
    }

    // Caller-scoped client: the anon key plus JWT makes all reads explicitly
    // subject to RLS. Never combine a service-role key with caller headers.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "NOT_AUTHENTICATED" }, 401, origin);
    }
    const userId = userData.user.id;

    // Parse request body. Hard cap : reject bodies > 4kB (video_id is ~32 chars).
    const contentLengthHeader = req.headers.get("Content-Length");
    if (contentLengthHeader && Number(contentLengthHeader) > 4096) {
      return json({ error: "PAYLOAD_TOO_LARGE" }, 413, origin);
    }
    let body: { video_id?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "INVALID_JSON" }, 400, origin);
    }
    const videoId = body?.video_id?.trim();
    if (!videoId || typeof videoId !== "string" || videoId.length < 10 || videoId.length > 64) {
      return json({ error: "INVALID_VIDEO_ID" }, 400, origin);
    }

    // ANTI-OTP-FISHING : verify the video ID belongs to a real lesson.
    // Otherwise any logged-in student could request OTPs for arbitrary VDOCipher
    // video IDs (leak-by-enumeration).
    //
    // Two courses, two tables :
    //   - Pflege      → public.lessons            (vdocipher_video_id, is_published)
    //   - Immigration → public.immigration_lessons (vdocipher_video_id, is_published)
    // Students may play published lessons only. Admins may also preview drafts.
    let videoAllowed = false;
    let lessonLabel = "";
    let apiKey = "";         // course-specific VDOCipher secret, chosen by the matched table
    let matchedCourse = "";  // 'pflege' | 'immigration' — used for the entitlement gate below
    let videoPublished = false;

    const { data: lesson, error: lessonErr } = await supabase
      .from("lessons")
      .select("lesson_number, is_published")
      .eq("vdocipher_video_id", videoId)
      .maybeSingle();
    if (lesson) {
      videoAllowed = true;
      lessonLabel = `pflege-${lesson.lesson_number}`;
      apiKey = VDOCIPHER_API_KEY;
      matchedCourse = "pflege";
      videoPublished = lesson.is_published === true;
    } else {
      const { data: immLesson } = await supabase
        .from("immigration_lessons")
        .select("lesson_slug, is_published")
        .eq("vdocipher_video_id", videoId)
        .maybeSingle();
      if (immLesson) {
        videoAllowed = true;
        lessonLabel = `immigration-${immLesson.lesson_slug}`;
        apiKey = VDOCIPHER_API_KEY_IMMIGRATION;
        matchedCourse = "immigration";
        videoPublished = immLesson.is_published === true;
      }
    }

    if (!videoAllowed) {
      console.warn("[vdocipher-otp] invalid video request", { userId, videoId, err: lessonErr });
      return json({ error: "INVALID_VIDEO" }, 403, origin);
    }

    // Profile lookup — revoked-account check + course entitlement + future
    // forensic watermarking when we want to re-enable per-user identification.
    const { data: profile } = await supabase
      .from("profiles")
      .select("first_name, last_name, email, revoked_at, course_access, is_admin")
      .eq("id", userId)
      .maybeSingle();
    if (!profile) {
      return json({ error: "NO_PROFILE" }, 403, origin);
    }
    if (profile.revoked_at) {
      return json({ error: "ACCOUNT_REVOKED" }, 403, origin);
    }

    // Draft videos are a preview feature for administrators only.
    if (!profile.is_admin && !videoPublished) {
      return json({ error: "INVALID_VIDEO" }, 403, origin);
    }

    // ENTITLEMENT GATE : the caller must actually own the course this video
    // belongs to (admins bypass). course_access is single-valued
    // ('pflege' | 'immigration'). Without this, any logged-in student could
    // stream the OTHER course's paid videos — the video IDs are readable and
    // the OTP is signed with that course's key regardless of what they bought.
    if (!profile.is_admin && profile.course_access !== matchedCourse) {
      console.warn("[vdocipher-otp] course entitlement mismatch", { userId, matchedCourse, has: profile.course_access });
      return json({ error: "COURSE_FORBIDDEN" }, 403, origin);
    }

    // The video is authorized; now ensure this course's key is configured.
    if (!apiKey) {
      console.error("[vdocipher-otp] missing VDOCipher API key for", lessonLabel);
      return json({ error: "SERVER_MISCONFIG" }, 500, origin);
    }

    // Branded watermark — user-requested change : no personal info shown
    // over the video player. Keeps the brand visible on any leaked screen
    // recording without exposing student name/email. If we want per-user
    // forensics back later, switch to `${first_name} ${last_name}`.
    const watermarkText = "© Aurel Academy · Tous droits réservés";

    // Call VDOCipher to mint OTP. Docs : https://www.vdocipher.com/blog/dynamic-watermarking
    //
    // ttl=300 : 5-min validity. After that the iframe needs a new OTP.
    // annotate : runtime watermark (anti-piracy forensics).
    // We don't set whitelisthref because that locks playback to a SINGLE
    // hardcoded URL ; cleaner to manage the whitelist at the account level
    // via the VDOCipher dashboard (multiple subdomains, PWA, etc.).
    const vdoResp = await fetch(`https://dev.vdocipher.com/api/videos/${encodeURIComponent(videoId)}/otp`, {
      method: "POST",
      headers: {
        "Authorization": `Apisecret ${apiKey}`,
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
      // R22 : don't leak upstream error body (could include hints / signed URLs).
      // Log server-side, return generic code to client.
      return json({ error: "VDOCIPHER_FAILED", status: vdoResp.status }, 502, origin);
    }

    const data = await vdoResp.json();
    if (!data?.otp || !data?.playbackInfo) {
      console.error("[vdocipher-otp] VDOCipher returned malformed payload", data);
      return json({ error: "VDOCIPHER_MALFORMED" }, 502, origin);
    }

    return json({
      ok: true,
      otp: data.otp,
      playbackInfo: data.playbackInfo,
      // Useful for debugging which lesson was requested (pflege-N / immigration-slug).
      lesson: lessonLabel,
    }, 200, origin);
  } catch (e) {
    console.error("[vdocipher-otp] unhandled", e);
    return json({ error: "INTERNAL" }, 500, origin);
  }
});
