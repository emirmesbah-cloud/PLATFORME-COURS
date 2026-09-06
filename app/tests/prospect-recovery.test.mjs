import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCopy, extractAssignments, reconstructEvidence } from '../../scripts/recover-prospect-assignments.mjs';

const id = '10000000-0000-0000-0000-000000000001';
const closer = '20000000-0000-0000-0000-000000000001';
const snapshot = (day, leads, extra = {}) => ({
  run_id: day, name: `backup-${day}.sql.gz`, sha256: 'abc', supported: true, attribution_columns: ['closer_user_id', 'closer_name'],
  started_at: `2026-09-0${day}T07:00:00Z`, created_at: `2026-09-0${day}T07:01:00Z`,
  leads: new Map(leads.map(lead => [lead.id, lead])), ...extra,
});

test('offline recovery reads only whitelisted lead attribution fields, never auth rows', async () => {
  const parsed = await extractAssignments([
    'COPY "auth"."users" ("id", "encrypted_password") FROM stdin;',
    'auth-sentinel\tpassword-sentinel', '\\.',
    'COPY "public"."webinar_leads" ("id", "email", "closer_user_id", "closer_name", "updated_at", "deleted_at") FROM stdin;',
    `${id}\tprivate-sentinel\t${closer}\tHana\t2026-01-01\t\\N`,
    '10000000-0000-0000-0000-000000000002\tdeleted-sentinel\t\\N\tHana\t2026-01-01\t2026-02-01', '\\.',
  ]);
  assert.equal(parsed.supported, true);
  assert.deepEqual([...parsed.leads.values()], [{ id, closer_id: closer, closer_name: 'Hana' }]);
  assert.doesNotMatch(JSON.stringify([...parsed.leads]), /sentinel|updated_at/);
  assert.equal(decodeCopy('\\N'), null);
  assert.equal(decodeCopy('Han\\141\\tX\\\\'), 'Hana\tX\\');
});

test('malformed or unsupported dumps cannot manufacture attribution states', async () => {
  const unsupported = await extractAssignments(['COPY "public"."webinar_leads" ("id") FROM stdin;', id, '\\.']);
  assert.equal(unsupported.supported, false);
  await assert.rejects(extractAssignments([
    'COPY "public"."webinar_leads" ("id", "closer_user_id", "closer_name") FROM stdin;', id,
  ]), /Malformed/);
});

test('first assigned snapshot does not pretend to be an assignment from unassigned', () => {
  const data = [snapshot(1, [{ id, closer_id: closer, closer_name: 'Hana' }])];
  const [event] = reconstructEvidence(data);
  assert.equal(event.metadata.recovery_kind, 'snapshot');
  assert.equal(event.metadata.previous_closer_name, undefined);
  assert.equal(event.metadata.interval_start, undefined);
});

test('changes use conservative intervals, retain removals, and deduplicate stable snapshots', () => {
  const free = { id, closer_id: null, closer_name: null };
  const hana = { id, closer_id: closer, closer_name: 'Hana' };
  const data = [snapshot(1, [free]), snapshot(2, [hana]), snapshot(3, [hana]), snapshot(4, [free])];
  const before = JSON.stringify(data.map(s => [...s.leads]));
  const events = reconstructEvidence(data);
  assert.equal(events.length, 2);
  assert.equal(events[0].metadata.recovery_kind, 'interval');
  assert.equal(events[0].metadata.interval_start, data[0].started_at);
  assert.equal(events[0].metadata.interval_end, data[1].created_at);
  assert.equal(events[1].metadata.interval_start, data[2].started_at);
  assert.equal(events[1].metadata.closer_name, null);
  assert.equal(events[1].metadata.previous_closer_name, 'Hana');
  assert.deepEqual(reconstructEvidence([...data].reverse()), events);
  assert.equal(JSON.stringify(data.map(s => [...s.leads])), before);
});

test('unsupported and missing snapshots are not treated as proof of unassignment', () => {
  const lead = { id, closer_id: closer, closer_name: 'Hana' };
  const events = reconstructEvidence([snapshot(1, [lead]), snapshot(2, [], { supported: false }), snapshot(3, []), snapshot(4, [lead])]);
  assert.equal(events.length, 1);
});

test('adding a closer ID column to an old named attribution is not a reassignment', () => {
  const events = reconstructEvidence([
    snapshot(1, [{ id, closer_id: null, closer_name: 'Hana' }], { attribution_columns: ['closer_name'] }),
    snapshot(2, [{ id, closer_id: closer, closer_name: 'Hana' }]),
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].metadata.recovery_kind, 'snapshot');
});
