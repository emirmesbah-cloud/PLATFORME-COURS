import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), 'utf8');

test('closer onboarding is admin-managed and has no public first-connection flow', () => {
  const source = read('../../supabase/functions/closer-access/index.ts');
  const page = read('../src/pages/public/CloserAccess.tsx');
  const config = read('../../supabase/config.toml');
  assert.match(source, /callerProfile\?\.is_admin/);
  assert.match(source, /admin\.auth\.admin\.createUser/);
  assert.match(source, /CLOSER_DEFAULT_PASSWORD/);
  assert.match(source, /password-changed/);
  assert.doesNotMatch(source, /inviteUserByEmail/);
  assert.doesNotMatch(page, /Première connexion/);
  assert.match(config, /\[functions\.closer-access\][\s\S]*verify_jwt = true/);
});

test('closer RLS is read-only and write RPCs are ownership-scoped', () => {
  const sql = read('../../supabase/migrations/20260824000072_sherlock_security_reliability.sql');
  assert.match(sql, /"Closers read assigned webinar leads"[\s\S]*FOR SELECT/);
  assert.doesNotMatch(sql, /CREATE POLICY "Staff prospect access"[\s\S]*FOR ALL/);
  assert.match(sql, /can_manage_webinar_lead\(v_uid, p_lead_id\)/);
  assert.match(sql, /v_lead\.closer_user_id IS DISTINCT FROM v_uid/);
});

test('legacy closer trigger is removed and scoped RPC validates notes/follow-ups', () => {
  const sql = read('../../supabase/migrations/20260827000077_manual_assignment_closer_followup.sql');
  assert.match(sql, /DROP TRIGGER IF EXISTS webinar_leads_protect_closer_update/);
  assert.match(sql, /p_status <> 'confirmed' AND v_note IS NULL/);
  assert.match(sql, /p_status = 'callback' AND p_next_follow_up_at IS NULL/);
  assert.match(sql, /can_manage_webinar_lead\(v_uid, p_lead_id\)/);
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

test('new webinar leads remain unassigned until an admin attributes them', () => {
  const sql = read('../../supabase/migrations/20260827000077_manual_assignment_closer_followup.sql');
  assert.match(sql, /DROP TRIGGER IF EXISTS webinar_leads_auto_assign/);
  assert.match(sql, /closer assignment is admin-only/);
});

test('order creation preserves the independent CRM status', () => {
  const sql = read('../../supabase/migrations/20260827000077_manual_assignment_closer_followup.sql');
  assert.match(sql, /DROP TRIGGER IF EXISTS delivery_orders_mark_webinar_lead/);
  assert.match(sql, /crm_status_preserved/);
  const bulkFunction = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.admin_bulk_create_orders'));
  assert.doesNotMatch(bulkFunction, /SET status = 'in_delivery'/);
});

test('modal focus trap is stable while controlled fields rerender', () => {
  const modal = read('../src/components/ui/Modal.tsx');
  assert.match(modal, /const onCloseRef = useRef\(onClose\)/);
  assert.match(modal, /\}, \[open\]\);/);
  assert.doesNotMatch(modal, /\}, \[open, onClose\]\);/);
});

test('closers cannot create sales or mark delivery, and reporting starts 26 August', () => {
  const sql = read('../../supabase/migrations/20260827000076_closer_access_sales_truth.sql');
  const ui = read('../src/pages/admin/AdminWebinarLeads.tsx');
  assert.match(sql, /DROP POLICY IF EXISTS "Closers update assigned lead status and note"/);
  assert.match(sql, /p_status NOT IN \('to_call', 'nrp', 'callback', 'not_interested', 'confirmed', 'returned'\)/);
  assert.match(sql, /IF NOT public\.is_admin\(v_uid\) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;/);
  assert.match(sql, /2026-08-26 00:00:00\+01/);
  assert.match(sql, /'actor', CASE WHEN v_is_admin THEN 'admin' ELSE 'closer' END/);
  assert.match(ui, /CLOSER_STATUS_OPTIONS[\s\S]*value: 'confirmed'/);
  assert.match(ui, /onCall=\{profile\?\.is_admin/);
  assert.match(ui, /Mes ventes livrées/);
  assert.match(ui, /h-6 w-6/);
});
