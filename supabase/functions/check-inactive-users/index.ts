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
import { reportError } from '../_shared/sentry.ts';

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

  // SHERLOCK R3 + GDPR : skip users qui ont opt-out des emails marketing.
  // `email_opt_out_marketing=TRUE` est défini quand l'user clique sur le
  // lien /unsubscribe?token=... dans n'importe quel mail précédent.
  // On select aussi `email_opt_out_token` qui est passé comme variable
  // dans l'email pour permettre le 1-click-unsubscribe.
  const { data: candidates, error: candErr } = await admin
    .from('profiles')
    .select('id, email, first_name, last_login_at, activated_at, email_opt_out_token, email_opt_out_marketing, revoked_at')
    .eq('is_admin', false)
    .eq('email_opt_out_marketing', false)
    .is('revoked_at', null)
    .lt('activated_at', sevenDaysAgo)
    .or(`last_login_at.is.null,last_login_at.lt.${sevenDaysAgo}`);

  if (candErr) {
    await reportError(candErr, { function: 'check-inactive-users', extra: { step: 'select_candidates' } });
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
            // GDPR : 1-click unsubscribe link, token-gated public RPC.
            unsubscribe_url:
              `https://app.aurel-academy.com/unsubscribe?token=${u.email_opt_out_token}`,
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
      await reportError(e, {
        function: 'check-inactive-users',
        user_id: u.id,
        level: 'warning',
        extra: { step: 'per_user_loop' },
      });
    }
  }

  // If we hit a high error rate, escalate one summary event so the cron is visible.
  if (errors.length > 0 && errors.length >= Math.max(3, Math.floor((candidates?.length ?? 0) / 4))) {
    await reportError(new Error(`check-inactive-users: ${errors.length} errors over ${candidates?.length ?? 0} candidates`), {
      function: 'check-inactive-users',
      level: 'error',
      extra: { sent, skipped, sample_errors: errors.slice(0, 5) },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    candidates: candidates?.length ?? 0,
    sent, skipped, errors: errors.slice(0, 10),
  }), { headers: { 'Content-Type': 'application/json' } });
});
