// ============================================================================
// Aurel Academy — Cron Edge Function : check-inactive-users
//
// À déclencher quotidiennement (ex : 9h UTC) via Supabase pg_cron ou
// Cloudflare Workers Cron Trigger.
//
// Comportement :
//   1. Trouve les profiles avec :
//      - last_login_at < NOW() - 7 days OR last_login_at IS NULL
//        ET activated_at < NOW() - 7 days
//      - is_admin = false
//      - progression < 100% (au moins 1 leçon non complétée)
//   2. Pour chaque user, vérifie qu'aucun email "reminder_inactive" n'a été
//      envoyé dans les 7 derniers jours.
//   3. Appelle send-email pour chaque user éligible.
//
// Auth : appelée avec une clé secrète CRON_SECRET pour éviter les abus.
// ============================================================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET               = Deno.env.get('CRON_SECRET') ?? '';

serve(async (req) => {
  // Vérification du secret (header OR query param)
  const url    = new URL(req.url);
  const secret = req.headers.get('x-cron-secret') ?? url.searchParams.get('secret') ?? '';
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Find inactive users
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: candidates, error: candErr } = await admin
    .from('profiles')
    .select('id, email, first_name, last_login_at, activated_at')
    .eq('is_admin', false)
    .lt('activated_at', sevenDaysAgo)
    .or(`last_login_at.is.null,last_login_at.lt.${sevenDaysAgo}`);

  if (candErr) {
    return new Response(JSON.stringify({ ok: false, error: candErr.message }), { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const u of candidates ?? []) {
    try {
      // Check if already received reminder in last 7 days
      const { data: recent } = await admin
        .from('email_logs')
        .select('id')
        .eq('user_id', u.id)
        .eq('email_type', 'reminder_inactive')
        .gt('sent_at', sevenDaysAgo)
        .limit(1)
        .maybeSingle();
      if (recent) { skipped++; continue; }

      // Check progression : skip if user has finished (certificate exists)
      const { data: cert } = await admin
        .from('certificates')
        .select('id')
        .eq('user_id', u.id)
        .maybeSingle();
      if (cert) { skipped++; continue; }

      // Get progress summary for percentage
      const { count: completedCount } = await admin
        .from('lesson_progress')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', u.id)
        .eq('completed', true);
      const { count: totalCount } = await admin
        .from('lessons')
        .select('id', { count: 'exact', head: true })
        .eq('is_published', true);
      const pct = totalCount && totalCount > 0
        ? Math.round(((completedCount ?? 0) / totalCount) * 100)
        : 0;

      // Find next uncompleted lesson
      const { data: nextLesson } = await admin
        .from('lessons')
        .select('lesson_number, title, id')
        .eq('is_published', true)
        .order('lesson_number', { ascending: true });

      let nextLessonNumber: number | null = null;
      let nextLessonTitle:  string | null = null;
      if (nextLesson) {
        const { data: doneLessonIds } = await admin
          .from('lesson_progress')
          .select('lesson_id')
          .eq('user_id', u.id)
          .eq('completed', true);
        const doneSet = new Set((doneLessonIds ?? []).map((r: { lesson_id: string }) => r.lesson_id));
        const next = nextLesson.find((l) => !doneSet.has(l.id));
        if (next) {
          nextLessonNumber = next.lesson_number;
          nextLessonTitle  = next.title;
        }
      }

      // Trigger send-email function
      const fnRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          email_type: 'reminder_inactive',
          to: u.email,
          user_id: u.id,
          vars: {
            first_name: u.first_name,
            percentage_complete: pct,
            next_lesson_number: nextLessonNumber,
            next_lesson_title: nextLessonTitle,
          },
        }),
      });

      if (!fnRes.ok) {
        const t = await fnRes.text();
        errors.push(`${u.email}: ${t}`);
        continue;
      }
      sent++;
    } catch (e) {
      errors.push(`${u.email}: ${(e as Error).message}`);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    candidates: candidates?.length ?? 0,
    sent, skipped, errors: errors.slice(0, 10),
  }), { headers: { 'Content-Type': 'application/json' } });
});
