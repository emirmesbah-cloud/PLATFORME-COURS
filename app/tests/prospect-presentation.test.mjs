import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../src/lib/prospectPresentation.ts', import.meta.url), 'utf8');
const helpers = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);

test('to-call and callback have distinct, consistent badge colors', () => {
  assert.match(helpers.leadStatusColor('to_call'), /blue/);
  assert.match(helpers.leadStatusColor('callback'), /violet/);
  assert.equal(helpers.leadStatusColor('new'), helpers.leadStatusColor('to_call'));
  assert.notEqual(helpers.leadStatusColor('callback'), helpers.leadStatusColor('to_call'));
});

test('registration sorting compares actual instants, not strings or last updates', () => {
  const rows = [
    { id: 'a', created_at: '2026-09-06T11:30:00+01:00', updated_at: '2027-01-01T00:00:00Z' },
    { id: 'b', created_at: '2026-09-06T10:45:00Z' },
    { id: 'c', created_at: 'invalid' },
  ];
  assert.deepEqual([...rows].sort((a,b) => helpers.compareRegistrationDate(a,b,'date_desc')).map(r=>r.id), ['b','a','c']);
  assert.deepEqual([...rows].sort((a,b) => helpers.compareRegistrationDate(a,b,'date_asc')).map(r=>r.id), ['a','b','c']);
  assert.equal(helpers.compareRegistrationDate(rows[0], rows[0], 'date_desc'), 0);
});

test('audit titles distinguish order handoff, confirmation, attribution and a contact click', () => {
  const event = { activity_type: 'delivery', status: 'confirmed', metadata: { action: 'order_created' } };
  assert.equal(helpers.adminActivityTitle(event), 'Passage en commande');
  assert.equal(helpers.adminActivityTitle({ ...event, activity_type: 'call', metadata: {} }), 'Prospect confirmé · suivi enregistré');
  assert.equal(helpers.adminActivityTitle({ ...event, activity_type: 'assignment', metadata: { closer_name: 'Hana', previous_closer_name: 'Rym' } }), 'Réattribution du prospect');
  assert.equal(helpers.adminActivityTitle({ ...event, activity_type: 'contact', metadata: { channel: 'whatsapp' } }), 'WhatsApp ouvert');
  assert.match(helpers.formatAuditDate('2026-09-06T10:01:02Z'), /11:01:02/);
});

test('admin audit and closer history use separate queries and scoped server endpoints', () => {
  const page = readFileSync(new URL('../src/pages/admin/AdminWebinarLeads.tsx', import.meta.url),'utf8');
  const sql = readFileSync(new URL('../../supabase/migrations/20260906000088_admin_prospect_audit.sql', import.meta.url),'utf8');
  assert.match(page, /const detailedHistory = !!profile\?\.is_admin && !closerExperience/);
  assert.match(page, /detailedHistory \? queryKeys.webinarLeadAdminHistory/);
  assert.match(page, /Date d’inscription : plus récent/);
  assert.match(page, /onClick=\{onWhatsApp\}/);
  assert.match(sql, /IF NOT coalesce\(public.is_admin\(auth.uid\(\)\),false\) THEN RAISE EXCEPTION 'FORBIDDEN'/);
  assert.match(sql, /call_completed',false/);
});
