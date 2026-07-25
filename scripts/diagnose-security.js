'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

function readEnv(filePath) {
  const env = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function record(results, name, passed, detail) {
  results.push({ name, passed, detail });
}

async function main() {
  const scriptsDir = __dirname;
  const appDir = path.resolve(scriptsDir, '..', 'app');
  const serviceEnv = readEnv(path.join(scriptsDir, '.env'));
  const publicEnv = readEnv(path.join(appDir, '.env.production'));
  const url = serviceEnv.SUPABASE_URL || publicEnv.VITE_SUPABASE_URL;
  const serviceKey = serviceEnv.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = publicEnv.VITE_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) {
    throw new Error('Missing Supabase URL, service-role key, or anonymous key.');
  }

  const service = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (process.argv[2] === '--cleanup-user') {
    const cleanupId = process.argv[3] || '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanupId)) {
      throw new Error('A valid disposable user UUID is required for cleanup.');
    }
    const { error } = await service.auth.admin.deleteUser(cleanupId);
    if (error) throw error;
    console.log(JSON.stringify({ ok: true, cleaned_up_user: cleanupId }));
    return;
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const email = `codex-security-audit-${suffix}@aurel-academy.com`;
  const password = `Audit-${suffix}-Aa9!`;
  const results = [];
  let userId = null;

  try {
    const settingsResponse = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey },
    });
    const authSettings = settingsResponse.ok ? await settingsResponse.json() : null;
    record(
      results,
      'public_email_signup_is_disabled',
      settingsResponse.ok && authSettings?.disable_signup === true,
      settingsResponse.ok
        ? `disable_signup=${String(authSettings?.disable_signup)}`
        : `Auth settings returned HTTP ${settingsResponse.status}.`,
    );

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;
    userId = created.user.id;

    const { error: profileError } = await service.from('profiles').insert({
      id: userId,
      email,
      first_name: 'Codex',
      last_name: 'Security Audit',
      whatsapp: '0000000000',
      tier: 'autonome',
      course_access: 'pflege',
      is_admin: false,
    });
    if (profileError) throw profileError;

    const student = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await student.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    const { data: ownProfile, error: ownProfileError } = await student
      .from('profiles')
      .select('id, course_access, is_admin')
      .eq('id', userId)
      .single();
    record(
      results,
      'student_can_read_own_profile',
      !ownProfileError && ownProfile?.course_access === 'pflege' && ownProfile?.is_admin === false,
      ownProfileError?.message || 'Own Pflege profile returned.',
    );

    const { error: privilegeError } = await student
      .from('profiles')
      .update({ is_admin: true, course_access: 'immigration' })
      .eq('id', userId);
    const { data: unchanged } = await service
      .from('profiles')
      .select('course_access, is_admin')
      .eq('id', userId)
      .single();
    record(
      results,
      'student_cannot_escalate_profile',
      Boolean(privilegeError) && unchanged?.course_access === 'pflege' && unchanged?.is_admin === false,
      privilegeError?.message || 'Unexpectedly accepted privileged profile update.',
    );

    const { data: immigrationRows, error: immigrationError } = await student
      .from('immigration_lessons')
      .select('lesson_slug, vdocipher_video_id')
      .limit(1);
    record(
      results,
      'pflege_student_cannot_read_immigration_media',
      !immigrationError && (immigrationRows?.length ?? 0) === 0,
      immigrationError?.message || `${immigrationRows?.length ?? 0} rows returned.`,
    );

    const { data: guessedImmigrationBonus, error: guessedImmigrationBonusError } = await student.storage
      .from('bonus-resources')
      .createSignedUrl('immigration/B1-tous-les-modeles.pdf', 60);
    record(
      results,
      'pflege_student_cannot_sign_immigration_bonus',
      Boolean(guessedImmigrationBonusError) && !guessedImmigrationBonus?.signedUrl,
      guessedImmigrationBonusError?.message || 'Unexpectedly created an Immigration bonus URL.',
    );

    const { data: lesson, error: lessonError } = await student
      .from('lessons')
      .select('id')
      .eq('is_published', true)
      .limit(1)
      .maybeSingle();
    record(
      results,
      'pflege_student_can_read_published_lessons',
      !lessonError && Boolean(lesson?.id),
      lessonError?.message || (lesson?.id ? 'Published lesson returned.' : 'No published lesson found.'),
    );

    if (lesson?.id) {
      const { error: directProgressError } = await student.from('lesson_progress').insert({
        user_id: userId,
        lesson_id: lesson.id,
        watched_seconds: 1,
        last_position_seconds: 1,
        completed: true,
      });
      record(
        results,
        'student_cannot_forge_progress_directly',
        Boolean(directProgressError),
        directProgressError?.message || 'Unexpectedly accepted direct progress insert.',
      );
    }

    const { data: status, error: statusError } = await student.rpc('get_my_quiz_status');
    record(
      results,
      'pflege_status_rpc_works',
      !statusError && status?.ok === true && Array.isArray(status?.lessons),
      statusError?.message || `ok=${String(status?.ok)}`,
    );

    const { data: answers, error: answersError } = await student
      .from('quiz_questions')
      .select('id, correct_index, explanation')
      .limit(1);
    record(
      results,
      'student_cannot_read_quiz_answer_key',
      Boolean(answersError) || (answers?.length ?? 0) === 0,
      answersError?.message || `${answers?.length ?? 0} answer-key row(s) returned.`,
    );

    const { error: promoteError } = await service
      .from('profiles')
      .update({ is_admin: true })
      .eq('id', userId);
    if (promoteError) throw promoteError;

    const { data: adminPflegeQuestions, error: adminPflegeError } = await student
      .rpc('admin_list_quiz_questions');
    record(
      results,
      'admin_can_read_pflege_answer_keys_via_guarded_rpc',
      !adminPflegeError && Array.isArray(adminPflegeQuestions) && adminPflegeQuestions.length > 0,
      adminPflegeError?.message || `${adminPflegeQuestions?.length ?? 0} questions returned.`,
    );

    const { data: adminImmigrationQuestions, error: adminImmigrationError } = await student
      .rpc('admin_list_immigration_quiz_questions');
    record(
      results,
      'admin_can_read_immigration_answer_keys_via_guarded_rpc',
      !adminImmigrationError &&
        Array.isArray(adminImmigrationQuestions) &&
        adminImmigrationQuestions.length > 0,
      adminImmigrationError?.message || `${adminImmigrationQuestions?.length ?? 0} questions returned.`,
    );

    const { data: adminPayments, error: adminPaymentsError } = await student
      .rpc('admin_list_payments', {
        p_status: null,
        p_tier: null,
        p_method: null,
        p_from: null,
        p_to: null,
      });
    record(
      results,
      'admin_can_list_accounting_rows_via_guarded_rpc',
      !adminPaymentsError && Array.isArray(adminPayments) && adminPayments.length > 0,
      adminPaymentsError?.message || `${adminPayments?.length ?? 0} payments returned.`,
    );

    const { error: switchCourseError } = await service
      .from('profiles')
      .update({ is_admin: false, course_access: 'immigration' })
      .eq('id', userId);
    if (switchCourseError) throw switchCourseError;

    const { data: pflegeRowsAsImmigration, error: pflegeRowsAsImmigrationError } = await student
      .from('lessons')
      .select('id')
      .limit(1);
    record(
      results,
      'immigration_student_cannot_read_pflege_lessons',
      !pflegeRowsAsImmigrationError && (pflegeRowsAsImmigration?.length ?? 0) === 0,
      pflegeRowsAsImmigrationError?.message || `${pflegeRowsAsImmigration?.length ?? 0} rows returned.`,
    );

    const { data: immigrationStatus, error: immigrationStatusError } = await student
      .rpc('get_my_immigration_status');
    record(
      results,
      'immigration_status_rpc_works',
      !immigrationStatusError &&
        immigrationStatus?.ok === true &&
        Array.isArray(immigrationStatus?.lessons),
      immigrationStatusError?.message || `ok=${String(immigrationStatus?.ok)}`,
    );

    const { data: immigrationAnswers, error: immigrationAnswersError } = await student
      .from('immigration_quiz_questions')
      .select('id, correct_index, explanation')
      .limit(1);
    record(
      results,
      'student_cannot_read_immigration_answer_key',
      Boolean(immigrationAnswersError) || (immigrationAnswers?.length ?? 0) === 0,
      immigrationAnswersError?.message || `${immigrationAnswers?.length ?? 0} answer-key row(s) returned.`,
    );

    const { data: immigrationBonusRows, error: immigrationBonusRowsError } = await student
      .from('bonus_resources')
      .select('id, file_url, course')
      .eq('course', 'immigration')
      .eq('is_published', true)
      .order('order_index', { ascending: true });
    const firstBonusPath = immigrationBonusRows?.[0]?.file_url;
    const { data: signedBonus, error: signedBonusError } = firstBonusPath
      ? await student.storage.from('bonus-resources').createSignedUrl(firstBonusPath, 60)
      : { data: null, error: new Error('No published Immigration bonus path.') };
    let signedBonusHttpOk = false;
    if (signedBonus?.signedUrl) {
      const signedResponse = await fetch(signedBonus.signedUrl);
      signedBonusHttpOk = signedResponse.ok && signedResponse.headers
        .get('content-type')
        ?.includes('application/pdf') === true;
    }
    record(
      results,
      'immigration_student_can_download_private_bonus',
      !immigrationBonusRowsError &&
        immigrationBonusRows?.length === 7 &&
        !signedBonusError &&
        signedBonusHttpOk,
      immigrationBonusRowsError?.message ||
        signedBonusError?.message ||
        `${immigrationBonusRows?.length ?? 0} rows; signed PDF HTTP ok=${signedBonusHttpOk}`,
    );

    const failed = results.filter((result) => !result.passed);
    console.log(JSON.stringify({
      ok: failed.length === 0,
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    if (userId) {
      let cleanupError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const cleanupClient = createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error } = await cleanupClient.auth.admin.deleteUser(userId);
        cleanupError = error;
        if (!error) break;
      }
      if (cleanupError) {
        console.error(`Cleanup failed for disposable user ${userId}: ${cleanupError.message}`);
        process.exitCode = 1;
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
