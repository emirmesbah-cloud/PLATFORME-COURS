import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), 'utf8');

test('closer onboarding requires a mailbox invitation', () => {
  const source = read('../../supabase/functions/closer-access/index.ts');
  assert.match(source, /inviteUserByEmail/);
  assert.doesNotMatch(source, /admin\.createUser/);
  assert.doesNotMatch(source, /email_confirm\s*:\s*true/);
  assert.doesNotMatch(source, /payload\?\.password/);
});

test('closer RLS is read-only and write RPCs are ownership-scoped', () => {
  const sql = read('../../supabase/migrations/20260824000072_sherlock_security_reliability.sql');
  assert.match(sql, /"Closers read assigned webinar leads"[\s\S]*FOR SELECT/);
  assert.doesNotMatch(sql, /CREATE POLICY "Staff prospect access"[\s\S]*FOR ALL/);
  assert.match(sql, /can_manage_webinar_lead\(v_uid, p_lead_id\)/);
  assert.match(sql, /v_lead\.closer_user_id IS DISTINCT FROM v_uid/);
});

test('legacy closer updates are limited to status and note by a database trigger', () => {
  const sql = read('../../supabase/migrations/20260824000074_closer_legacy_write_guard.sql');
  assert.match(sql, /to_jsonb\(NEW\) - ARRAY\['status', 'note', 'updated_at'\]/);
  assert.match(sql, /OLD\.closer_user_id IS DISTINCT FROM v_uid/);
  assert.match(sql, /NEW\.closer_user_id IS DISTINCT FROM v_uid/);
  assert.match(sql, /FOR UPDATE TO authenticated/);
});

test('student administration excludes closer and admin profiles', () => {
  const queries = read('../src/lib/queries.ts');
  assert.match(queries, /\.eq\('is_admin', false\)[\s\S]*\.eq\('staff_role', 'student'\)/);
});

test('Meta Pixel is consent-gated and not embedded globally', () => {
  const html = read('../index.html');
  const pixel = read('../src/lib/pixel.ts');
  const headers = read('../public/_headers');
  assert.doesNotMatch(html, /fbq\(|connect\.facebook\.net/);
  assert.match(pixel, /hasMetaConsent\(\)/);
  assert.doesNotMatch(headers, /script-src[^;]*'unsafe-inline'/);
});

test('public lead concurrency controls are atomic database functions', () => {
  const edge = read('../../supabase/functions/webinar-lead/index.ts');
  const sql = read('../../supabase/migrations/20260824000072_sherlock_security_reliability.sql');
  assert.match(edge, /consume_webinar_lead_rate_limit/);
  assert.match(edge, /service_insert_webinar_lead/);
  assert.match(sql, /ON CONFLICT \(key_hash\) DO UPDATE/);
  assert.match(sql, /pg_advisory_xact_lock/);
});
