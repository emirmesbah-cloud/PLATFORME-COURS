import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const FALLBACK_URL = 'https://www.youtube.com/channel/UCPPFO0edrI4sc6m4b9WTAdQ';
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

function safeYouTubeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return FALLBACK_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return FALLBACK_URL;
    if (url.username || url.password || url.port) return FALLBACK_URL;
    return url.toString();
  } catch {
    return FALLBACK_URL;
  }
}

function redirect(location: string, requestMethod: string): Response {
  return new Response(requestMethod === 'HEAD' ? null : '', {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

Deno.serve(async (request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  }

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await admin
      .from('readiness_simulator_settings')
      .select('live_url')
      .eq('id', true)
      .maybeSingle();

    if (error) console.error('[readiness-live] settings lookup failed', error.message);
    return redirect(safeYouTubeUrl(data?.live_url), request.method);
  } catch (error) {
    console.error('[readiness-live] unexpected failure', error);
    return redirect(FALLBACK_URL, request.method);
  }
});
