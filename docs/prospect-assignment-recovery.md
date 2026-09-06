# Recovered attribution evidence

Recovered observations are displayed only in the admin prospect timeline. They
are a separate `assignment_evidence` event type, never native `assignment`
events. The shared closer history and current CRM fields remain unchanged.

## Evidence semantics

- `snapshot`: the closer state found in a backup. Its timestamp is the backup
  launch time, approximately, **not** an assignment timestamp.
- `interval`: different states in two snapshots. The conservative interval runs
  from the earlier dump launch to the later artifact creation. Intermediate
  changes and the exact assignment time are unknown.
- `correlation`: a manually reviewed probable time supported by multiple sources.
  Matching a row's `updated_at` to an assignment API request is not proof of the
  target lead or actor when request parameters are absent.

Recovered events always have an unknown actor, null CRM status, and an explicit
uncertainty label. Sorting by the evidence timestamp does not make it an exact
assignment date. A newly added closer ID column is not itself a reassignment.

## Operator workflow

1. Deploy migration `20260906000089` and the matching frontend through the normal
   reviewed PR workflow. The migration contains no real customer/closer data.
2. Obtain explicit authorization before accessing full archives, which may also
   contain authentication data. Never execute or restore backup SQL to recover
   evidence. Keep downloaded archives outside Git and delete temporary copies
   when extraction is complete.
3. `scripts/recover-prospect-assignments.mjs` reads only attribution columns from
   `public.webinar_leads` COPY sections. It never interprets `auth` records or
   retains contact information. Provide a private artifact manifest containing
   `name`, `run_id`, and GitHub artifact `created_at`, plus the download root.
4. Review the generated observations and source hashes locally. Keep the payload
   private (for example under the ignored `outputs/private-prospect-recovery/`).
   Do not attach it to a PR, commit, CI log or public artifact.
5. As the database owner, call `public.import_webinar_assignment_evidence` with the
   reviewed JSON array in a short transaction. Each entry has `lead_id`,
   `created_at`, optional `note`, and `metadata` containing `recovery_key` and
   `recovery_kind`, with source/state fields. No application role has execution
   permission. The function is security-invoker, not privilege-elevating.
6. Check returned submitted/inserted/skipped counts and the admin-only UI. Missing
   or soft-deleted prospects are skipped; no prospects are recreated. Reusing a
   recovery key for the same lead is an idempotent no-op. Existing native audit
   entries are not overwritten.

Tests cover role isolation, replay, skipped/deleted leads, unchanged CRM rows,
native audit preservation, backup parsing, uncertainty labels and date windows.
The private production payload requires a separate operator import after merge;
deploying the generic code does not import it automatically.
