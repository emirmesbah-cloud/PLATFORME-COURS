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
  assert.match(page, /Filtrer par date d’inscription/);
  assert.match(page, /onClick=\{onWhatsApp\}/);
  assert.match(sql, /IF NOT coalesce\(public.is_admin\(auth.uid\(\)\),false\) THEN RAISE EXCEPTION 'FORBIDDEN'/);
  assert.match(sql, /call_completed',false/);
});

test('registration calendar filters inclusive Algerian days, including midnight boundaries', () => {
  const matches = helpers.matchesRegistrationDateRange;
  assert.equal(matches('2026-09-05T22:59:59.999Z', '2026-09-06', '2026-09-06'), false);
  assert.equal(matches('2026-09-05T23:00:00Z', '2026-09-06', '2026-09-06'), true);
  assert.equal(matches('2026-09-06T22:59:59.999Z', '2026-09-06', '2026-09-06'), true);
  assert.equal(matches('2026-09-06T23:00:00Z', '2026-09-06', '2026-09-06'), false);
  assert.equal(matches('2026-09-06T00:30:00+01:00', '2026-09-06', '2026-09-06'), true);
  assert.match(helpers.formatRegistrationDate('2026-09-05T23:00:00Z'), /06\/09\/2026.*00:00/);
});

test('registration filter supports open ranges and reset, and rejects invalid ranges', () => {
  const matches = helpers.matchesRegistrationDateRange;
  assert.equal(matches('2026-09-10T12:00:00Z', '2026-09-06', ''), true);
  assert.equal(matches('2026-09-01T12:00:00Z', '', '2026-09-06'), true);
  assert.equal(matches('2026-09-10T12:00:00Z', '', '2026-09-06'), false);
  assert.equal(matches('invalid', '', ''), true);
  assert.equal(matches('invalid', '2026-09-06', ''), false);
  assert.equal(matches('2026-09-06T12:00:00Z', '2026-09-07', '2026-09-06'), false);
  assert.equal(matches('2026-09-06T12:00:00Z', '2026-02-30', ''), false);
  assert.equal(matches('2026-09-06T12:00:00Z', 'invalid', ''), false);
});

test('desktop and mobile show registration time, preserve notes, and expose calendar fields', () => {
  const page = readFileSync(new URL('../src/pages/admin/AdminWebinarLeads.tsx', import.meta.url),'utf8');
  assert.equal((page.match(/type="date"/g) ?? []).length, 2);
  assert.match(page, /matchesRegistrationDateRange\(lead.created_at, registrationFrom, registrationTo\)/);
  assert.doesNotMatch(page, /Dernier suivi|lead.last_call_at/);
  assert.equal((page.match(/formatRegistrationDate\(lead.created_at\)/g) ?? []).length, 2);
  assert.match(page, /registrationFrom, registrationTo\]/);
  assert.match(page, /Effacer les dates/);
  assert.match(page, /lead.latest_call_note &&/);
  assert.match(page, /Rappel prévu/);
});
