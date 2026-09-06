// Offline, read-only extraction. Never execute a dump or parse auth tables.
// Usage: node scripts/recover-prospect-assignments.mjs manifest.json backup-root
// Output contains only lead IDs, closer attribution evidence and provenance.
import { createReadStream, readFileSync, readdirSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function decodeCopy(value) {
  if (value === '\\N') return null;
  return value.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|[btnrfv\\])/g, (_, token) => {
    if (token.startsWith('x')) return String.fromCharCode(parseInt(token.slice(1), 16));
    if (/^[0-7]/.test(token)) return String.fromCharCode(parseInt(token, 8));
    return { b: '\b', t: '\t', n: '\n', r: '\r', f: '\f', v: '\v', '\\': '\\' }[token];
  });
}

export async function extractAssignments(lines) {
  const leads = new Map();
  let indexes = null, fieldCount = 0, supported = false, attribution_columns = [];
  for await (const line of lines) {
    if (line.startsWith('COPY ')) {
      indexes = null;
      const match = line.match(/^COPY "public"\."webinar_leads" \((.+)\) FROM stdin;$/);
      if (!match) continue;
      const columns = match[1].split(', ').map(value => value.replace(/^"|"$/g, ''));
      attribution_columns = columns.filter(column => /closer|assign|attribut/.test(column));
      if (!columns.includes('id') || !columns.some(column => ['closer_user_id', 'closer_name'].includes(column))) continue;
      indexes = Object.fromEntries(['id', 'closer_user_id', 'closer_name', 'deleted_at'].map(column => [column, columns.indexOf(column)]));
      fieldCount = columns.length;
      supported = true;
      continue;
    }
    if (line === '\\.') { indexes = null; continue; }
    if (!indexes) continue;
    const fields = line.split('\t');
    if (fields.length !== fieldCount) throw new Error('Malformed public.webinar_leads COPY row');
    const value = key => indexes[key] < 0 ? null : decodeCopy(fields[indexes[key]]);
    if (value('deleted_at')) continue;
    const id = value('id');
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id ?? '')) throw new Error('Invalid lead UUID');
    if (leads.has(id)) throw new Error('Duplicate lead UUID in backup');
    leads.set(id, { id, closer_id: value('closer_user_id'), closer_name: value('closer_name') });
  }
  return { supported, attribution_columns, leads };
}

export function reconstructEvidence(snapshots) {
  const latest = new Map(), evidence = [];
  const assigned = lead => !!(lead.closer_id || lead.closer_name);
  for (const snapshot of [...snapshots].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    if (!snapshot.supported) continue;
    for (const lead of snapshot.leads.values()) {
      const previous = latest.get(lead.id);
      // A newly added ID column does not prove a reassignment of a named closer.
      const comparableIds = previous && previous.snapshot.attribution_columns?.includes('closer_user_id')
        && snapshot.attribution_columns?.includes('closer_user_id');
      const changed = previous && ((comparableIds && previous.lead.closer_id !== lead.closer_id) || previous.lead.closer_name !== lead.closer_name);
      if ((!previous && assigned(lead)) || (changed && (assigned(lead) || assigned(previous.lead)))) {
        const metadata = {
          recovery_key: `backup-${snapshot.run_id}-${lead.id}`,
          recovery_kind: previous ? 'interval' : 'snapshot',
          closer_id: lead.closer_id, closer_name: lead.closer_name,
          backup_file: snapshot.name, backup_run_id: String(snapshot.run_id), backup_sha256: snapshot.sha256,
        };
        if (previous) Object.assign(metadata, {
          previous_closer_id: previous.lead.closer_id, previous_closer_name: previous.lead.closer_name,
          previous_backup_file: previous.snapshot.name, previous_backup_run_id: String(previous.snapshot.run_id),
          previous_backup_sha256: previous.snapshot.sha256,
          // Bounds deliberately enclose the dump snapshots, whose precise
          // transaction instants are not available. Never use updated_at.
          interval_start: previous.snapshot.started_at, interval_end: snapshot.created_at,
        });
        evidence.push({ lead_id: lead.id, created_at: snapshot.started_at, metadata });
      }
      latest.set(lead.id, { lead, snapshot });
    }
  }
  return evidence;
}

function filesIn(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? filesIn(join(root, entry.name)) : entry.name.endsWith('.sql.gz') ? [join(root, entry.name)] : []);
}

async function main() {
  const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const paths = filesIn(resolve(process.argv[3]));
  const snapshots = [];
  for (const item of manifest) {
    const candidates = paths.filter(path => path.endsWith(item.name));
    if (candidates.length !== 1) throw new Error(`Expected exactly one copy of ${item.name}`);
    const match = item.name.match(/^aurel-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sql\.gz$/);
    if (!match) throw new Error('Invalid backup name');
    const started_at = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
    if (!(Date.parse(item.created_at) >= Date.parse(started_at))) throw new Error('Invalid backup time bounds');
    const hash = createHash('sha256');
    const input = createReadStream(candidates[0]);
    input.on('data', chunk => hash.update(chunk));
    const gzip = createGunzip();
    input.on('error', error => gzip.destroy(error));
    const parsed = await extractAssignments(createInterface({ input: input.pipe(gzip), crlfDelay: Infinity }));
    snapshots.push({ ...item, started_at, sha256: hash.digest('hex'), ...parsed });
  }
  const evidence = reconstructEvidence(snapshots);
  process.stdout.write(JSON.stringify({
    snapshots: snapshots.map(({ leads, ...snapshot }) => ({ ...snapshot, lead_count: leads.size,
      assigned_count: [...leads.values()].filter(lead => lead.closer_id || lead.closer_name).length })),
    evidence,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
