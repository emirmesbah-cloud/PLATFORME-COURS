-- ============================================================================
-- Aurel Academy — Plateforme étudiant — Phase 1
-- Migration 001 : schéma initial (types, tables, RLS, policies)
-- ============================================================================

-- 1. ENUM tier (Autonome 12 900 DA / Accompagné 42 800 DA)
DO $$ BEGIN
  CREATE TYPE tier_enum AS ENUM ('autonome', 'accompagne');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. activation_codes
--    Codes générés par scripts/generate-codes.js, envoyés par WhatsApp
--    après paiement. Format AU-XXXX (Autonome) ou AC-XXXX (Accompagné).
CREATE TABLE IF NOT EXISTS activation_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,
  tier            tier_enum NOT NULL,
  is_used         BOOLEAN NOT NULL DEFAULT FALSE,
  used_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      TEXT DEFAULT 'aurel',
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS activation_codes_code_idx        ON activation_codes (code);
CREATE INDEX IF NOT EXISTS activation_codes_is_used_idx     ON activation_codes (is_used);
CREATE INDEX IF NOT EXISTS activation_codes_used_by_idx     ON activation_codes (used_by_user_id);

ALTER TABLE activation_codes ENABLE ROW LEVEL SECURITY;
-- Pas de policy SELECT/INSERT/UPDATE pour rôle anon ou authenticated :
-- l'activation passe exclusivement par les RPC SECURITY DEFINER + le service_role
-- (script generate-codes.js / edge function activate-account).

-- 3. profiles
--    1 row par utilisateur authentifié, créé après redeem du code d'activation.
CREATE TABLE IF NOT EXISTS profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             TEXT UNIQUE NOT NULL,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  whatsapp          TEXT NOT NULL,
  tier              tier_enum NOT NULL,
  activated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  diplome_algerien  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at     TIMESTAMPTZ
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- L'utilisateur lit son propre profil
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- L'utilisateur met à jour son propre profil (pas l'email/tier — voir trigger ci-dessous)
CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Trigger : empêcher l'utilisateur de modifier son tier ou son email via UPDATE.
-- Seul le service_role peut changer ces champs.
CREATE OR REPLACE FUNCTION protect_profile_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    -- service_role bypasse cette protection
    RETURN NEW;
  END IF;

  IF NEW.tier IS DISTINCT FROM OLD.tier THEN
    RAISE EXCEPTION 'Modification du tier interdite';
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Modification de l''email interdite (passe par auth.users)';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Modification de l''id interdite';
  END IF;

  IF NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'Modification de activated_at interdite';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_immutable ON profiles;
CREATE TRIGGER profiles_protect_immutable
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_profile_immutable_fields();

-- 4. lessons (catalogue : 18 leçons fixes)
CREATE TABLE IF NOT EXISTS lessons (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_number       INT UNIQUE NOT NULL CHECK (lesson_number BETWEEN 1 AND 18),
  title               TEXT NOT NULL,
  subtitle            TEXT NOT NULL,
  duration_minutes    INT NOT NULL CHECK (duration_minutes > 0),
  vdocipher_video_id  TEXT,
  module_parent       TEXT NOT NULL,
  phase               TEXT NOT NULL,
  order_index         INT NOT NULL UNIQUE,
  is_published        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lessons_phase_idx       ON lessons (phase);
CREATE INDEX IF NOT EXISTS lessons_order_idx       ON lessons (order_index);
CREATE INDEX IF NOT EXISTS lessons_published_idx   ON lessons (is_published);

ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read lessons"
  ON lessons FOR SELECT
  TO authenticated
  USING (true);

-- 5. lesson_progress (1 row par (user_id, lesson_id))
CREATE TABLE IF NOT EXISTS lesson_progress (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id              UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  watched_seconds        INT NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
  completed              BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at           TIMESTAMPTZ,
  last_position_seconds  INT NOT NULL DEFAULT 0 CHECK (last_position_seconds >= 0),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS lesson_progress_user_idx     ON lesson_progress (user_id);
CREATE INDEX IF NOT EXISTS lesson_progress_lesson_idx   ON lesson_progress (lesson_id);
CREATE INDEX IF NOT EXISTS lesson_progress_completed_idx ON lesson_progress (user_id, completed);

ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;

-- L'utilisateur a tous les droits CRUD sur ses propres rows
CREATE POLICY "Users manage own progress"
  ON lesson_progress FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 6. bonus_resources (catalogue : 7 ressources)
CREATE TABLE IF NOT EXISTS bonus_resources (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  file_url      TEXT,
  file_type     TEXT NOT NULL,
  order_index   INT NOT NULL UNIQUE,
  is_published  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bonus_resources_order_idx     ON bonus_resources (order_index);
CREATE INDEX IF NOT EXISTS bonus_resources_published_idx ON bonus_resources (is_published);

ALTER TABLE bonus_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read bonus"
  ON bonus_resources FOR SELECT
  TO authenticated
  USING (true);

-- 7. bonus_downloads (1 row par (user_id, bonus_resource_id, downloaded_at))
--    Pas de UNIQUE : on log chaque téléchargement individuellement.
CREATE TABLE IF NOT EXISTS bonus_downloads (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bonus_resource_id  UUID NOT NULL REFERENCES bonus_resources(id) ON DELETE CASCADE,
  downloaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bonus_downloads_user_idx      ON bonus_downloads (user_id);
CREATE INDEX IF NOT EXISTS bonus_downloads_resource_idx  ON bonus_downloads (bonus_resource_id);

ALTER TABLE bonus_downloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own downloads"
  ON bonus_downloads FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own downloads"
  ON bonus_downloads FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 8. Mise à jour automatique de last_login_at via trigger sur auth.sessions
--    Le trigger natif de Supabase n'expose pas auth.sessions ; on met à jour
--    last_login_at via une RPC appelée côté client après auth.signInWithPassword.
--    Voir migration 004 : RPC `touch_last_login`.

-- ============================================================================
-- FIN migration 001
-- ============================================================================
