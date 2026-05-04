-- ============================================================================
-- _backfill_schema_migrations.sql
--
-- ⚠️  ONE-TIME OPS PASTE ⚠️
--
-- À paster UNE FOIS dans le SQL Editor Supabase pour aligner le tracker de
-- migrations avec ce qui a été appliqué manuellement (mig 001-018).
--
-- Ce fichier n'est PAS une "migration" au sens Supabase (il ne porte pas de
-- timestamp filename) — c'est une utilité ops pour réparer l'historique
-- avant de pouvoir utiliser `supabase db push` automatiquement.
--
-- Comportement après paste :
--   - Toutes les migrations 001-018 deviennent "déjà appliquées" pour le CLI
--   - Les futures migrations 019+ pourront être push via le workflow
--     deploy-migrations sans hit "table already exists"
--   - Idempotent (ON CONFLICT DO NOTHING) : safe à re-run
--
-- Source : Sherlock R2 finding #6 / R3 ops unblocker.
-- ============================================================================

INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES
  ('20260426000001', 'initial_schema',                       ARRAY['-- pre-applied via SQL Editor']),
  ('20260426000002', 'seed_lessons',                         ARRAY['-- pre-applied via SQL Editor']),
  ('20260426000003', 'seed_bonus',                           ARRAY['-- pre-applied via SQL Editor']),
  ('20260426000004', 'rpc_functions',                        ARRAY['-- pre-applied via SQL Editor']),
  ('20260426000005', 'storage',                              ARRAY['-- pre-applied via SQL Editor']),
  ('20260426000006', 'admin_role',                           ARRAY['-- pre-applied via SQL Editor']),
  ('20260427000007', 'phase3_features',                      ARRAY['-- pre-applied via SQL Editor']),
  ('20260429000008', 'single_session',                       ARRAY['-- pre-applied via SQL Editor']),
  ('20260429000009', 'soft_delete',                          ARRAY['-- pre-applied via SQL Editor']),
  ('20260429000010', 'fix_profiles_rls_recursion',           ARRAY['-- pre-applied via SQL Editor']),
  ('20260429000011', 'admin_generate_codes_inline_audit',    ARRAY['-- pre-applied via SQL Editor']),
  ('20260503000012', 'fix_admin_revoke_audit',               ARRAY['-- pre-applied via SQL Editor']),
  ('20260503000013', 'cap_watched_seconds',                  ARRAY['-- pre-applied via SQL Editor']),
  ('20260503000014', 'security_sweep',                       ARRAY['-- pre-applied via SQL Editor']),
  ('20260503000015', 'is_admin_revoked_guard',               ARRAY['-- pre-applied via SQL Editor']),
  ('20260503000016', 'sherlock_r3_backend',                  ARRAY['-- pre-applied via SQL Editor']),
  ('20260503000017', 'code_keyspace_6char',                  ARRAY['-- pre-applied via SQL Editor']),
  ('20260503000018', 'gdpr_purge_unsubscribe',               ARRAY['-- pre-applied via SQL Editor'])
ON CONFLICT (version) DO NOTHING;

-- Verify after running :
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
