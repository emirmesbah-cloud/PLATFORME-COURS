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

test('closers cannot create sales or mark delivery, and reporting covers the full assigned history', () => {
  const sql = read('../../supabase/migrations/20260827000078_crm_timelines_and_order_history.sql');
  const ui = read('../src/pages/admin/AdminWebinarLeads.tsx');
  assert.match(sql, /p_status NOT IN \('to_call', 'nrp', 'callback', 'not_interested', 'confirmed', 'returned'\)/);
  assert.match(sql, /IF NOT public\.is_admin\(v_uid\) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;/);
  assert.doesNotMatch(sql, /2026-08-26/);
  assert.match(sql, /WHERE l\.closer_name IS NOT NULL/);
  assert.match(sql, /'actor', CASE WHEN v_is_admin THEN 'admin' ELSE 'closer' END/);
  assert.match(ui, /CLOSER_STATUS_OPTIONS[\s\S]*value: 'confirmed'/);
  assert.match(ui, /onCall=\{profile\?\.is_admin/);
  assert.match(ui, /Mes ventes livrées/);
  assert.match(ui, /h-6 w-6/);
  assert.doesNotMatch(ui, /key: 'anciens'/);
  assert.doesNotMatch(ui, /quickOptions|setQuick\(/);
  assert.match(ui, /Appel WhatsApp/);
  assert.match(ui, /Appel téléphonique/);
  assert.match(ui, /href=\{`tel:\$\{internationalPhone/);
});

test('prospect notes and statuses are kept in a shared scoped timeline', () => {
  const sql = read('../../supabase/migrations/20260827000078_crm_timelines_and_order_history.sql');
  const backfill = read('../../supabase/migrations/20260827000079_backfill_legacy_crm_notes.sql');
  const ui = read('../src/pages/admin/AdminWebinarLeads.tsx');
  assert.match(sql, /staff_get_webinar_lead_history/);
  assert.match(sql, /can_manage_webinar_lead\(auth\.uid\(\), p_lead_id\)/);
  assert.match(sql, /'call_attempt'/);
  assert.match(sql, /call_count \+ 1/);
  assert.match(ui, /LeadHistoryTimeline/);
  assert.match(ui, /1er appel/);
  assert.match(ui, /Oui, confirmer/);
  assert.doesNotMatch(ui, />\s*Note\s*</);
  assert.match(backfill, /source', 'prospect_note'/);
  assert.match(backfill, /source', 'latest_call_note'/);
  assert.match(backfill, /NOT EXISTS/);
});

test('only confirmed prospects become orders and ready-to-ship orders enter history', () => {
  const sql = read('../../supabase/migrations/20260827000078_crm_timelines_and_order_history.sql');
  const prospects = read('../src/pages/admin/AdminWebinarLeads.tsx');
  const orders = read('../src/pages/admin/AdminDeliveryOrders.tsx');
  assert.match(sql, /v_lead\.status <> 'confirmed'/);
  assert.match(prospects, /ne sont pas encore « Confirmé »/);
  assert.match(orders, /Historique des commandes/);
  assert.match(orders, /if \(order\.ecom_confirmed\) return true/);
  assert.match(orders, /déplacé dans Historique des commandes/);
});

test('closers can read only the E-com status of their assigned prospects', () => {
  const sql = read('../../supabase/migrations/20260827000080_closer_ecom_status_visibility.sql');
  const queries = read('../src/lib/queries.ts');
  const ui = read('../src/pages/admin/AdminWebinarLeads.tsx');

  assert.match(sql, /staff_get_webinar_delivery_statuses/);
  assert.match(sql, /l\.closer_user_id = auth\.uid\(\)/);
  assert.match(sql, /has_staff_permission\(auth\.uid\(\), 'prospects'\)/);
  assert.match(sql, /RETURNS TABLE \([\s\S]*ecom_tracking text,[\s\S]*ecom_situation text/);
  assert.doesNotMatch(sql, /cod_amount|supplier_notes|address/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.staff_get_webinar_delivery_statuses\(\) FROM PUBLIC/);
  assert.match(queries, /supabase\.rpc\('staff_get_webinar_delivery_statuses'\)/);
  assert.match(queries, /statusByLead\.get\(lead\.id\)/);
  assert.match(ui, /function LeadCard[\s\S]*E-com[\s\S]*order\.ecom_situation/);
});

test('readiness Live destination is a singleton, admin-only replacement with a non-cacheable public redirect', () => {
  const sql = read('../../supabase/migrations/20260827000081_readiness_live_link.sql');
  const edge = read('../../supabase/functions/readiness-live/index.ts');
  const config = read('../../supabase/config.toml');
  const page = read('../src/pages/admin/AdminReadinessSimulator.tsx');

  assert.match(sql, /id\s+BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK \(id\)/);
  assert.match(sql, /NOT public\.is_admin\(v_uid\)/);
  assert.match(sql, /WHERE id = TRUE[\s\S]*RETURNING \* INTO v_row/);
  assert.match(sql, /readiness_live_url_replaced/);
  assert.match(edge, /status: 302/);
  assert.match(edge, /Cache-Control': 'no-store, no-cache/);
  assert.match(edge, /\.eq\('id', true\)/);
  assert.match(config, /\[functions\.readiness-live\][\s\S]*verify_jwt = false/);
  assert.match(page, /L'ancien lien a été remplacé/);
});

test('retired webinar groups immediately lose every sticky assignment', () => {
  const sql = read('../../supabase/migrations/20260827000082_retired_webinar_groups_stop_immediately.sql');

  assert.match(sql, /AFTER UPDATE OF status ON public\.webinar_rotation_links/);
  assert.match(sql, /NEW\.status = 'retired'/);
  assert.match(sql, /DELETE FROM public\.webinar_rotation_stickies[\s\S]*WHERE link_id = NEW\.id/);
  assert.match(sql, /DELETE FROM public\.webinar_rotation_stickies s[\s\S]*l\.status = 'retired'/);
});
