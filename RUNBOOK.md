# 📕 RUNBOOK — Aurel Academy

> Procédures de réaction aux incidents critiques de production.
> Garde ce fichier à portée de main (ou print-out à côté du laptop).
>
> **Dernière mise à jour : 2026-04-29** (V1, 3 scénarios)

---

## 📞 Contacts d'urgence

| Service | Contact / Lien |
|---|---|
| Toi (admin) | `emirmesbah@gmail.com` · WhatsApp `+213 555 290 826` |
| Closers | Hana, Aymen, Djihane (cf. apps-script.gs) |
| Hébergeur cPanel | Octenium support — via espace client |
| Cloudflare | [https://dash.cloudflare.com/?to=/:account/support](https://dash.cloudflare.com/?to=/:account/support) |
| Supabase | [https://supabase.com/dashboard/support/new](https://supabase.com/dashboard/support/new) |
| Resend | [https://resend.com/help](https://resend.com/help) |
| GitHub | [https://support.github.com](https://support.github.com) |

---

## 🚨 Comment utiliser ce runbook

1. **Identifie le scénario** dans la liste ci-dessous
2. **Suis les étapes dans l'ordre** — ne saute pas les checks de préchecks
3. **Communique avec les utilisateurs** dès que possible (post sur Telegram d'Aurel, statut WhatsApp, etc.)
4. **Documente** ce que tu fais (capture d'écran, log) pour post-mortem
5. **Post-mortem** dans `docs/post-mortems/YYYY-MM-DD-<slug>.md` après résolution

---

## Scénario 1 — Supabase totalement down (DB inaccessible)

**Symptômes** :
- Plateforme `app.aurel-academy.com` affiche page blanche ou erreur "Network error"
- `/health` retourne 503 ou timeout
- Login impossible
- Sentry alerte "Supabase fetch errors spike"

### Étape 1 — Confirmer l'incident (2 min)

1. Va sur [https://status.supabase.com](https://status.supabase.com) → check si incident côté Supabase
2. Test `/health` :
   ```bash
   curl https://dvrqtqghgaxhhgkoihcj.supabase.co/functions/v1/health
   ```
3. Test direct DB (si tu as `psql` local) :
   ```bash
   psql "postgresql://postgres.dvrqtqghgaxhhgkoihcj:<password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" -c "SELECT 1;"
   ```

### Étape 2 — Si incident Supabase confirmé

→ **Tu ne peux rien faire côté technique.** Communique à tes étudiants :

1. Post sur ton WhatsApp Status :
   > 🚨 La plateforme rencontre un souci technique côté serveur. Notre prestataire travaille dessus. On revient en ligne sous 1-2h.

2. Email broadcast aux étudiants actifs (via Resend dashboard) :
   > Sujet : Maintenance temporaire — Aurel Academy
   > Bonjour, la plateforme est temporairement inaccessible suite à un incident chez notre hébergeur (Supabase). Tes données sont en sécurité. Tu pourras te reconnecter dans quelques heures. Merci de ta patience.

3. Refresh status.supabase.com toutes les 15 min jusqu'à résolution

### Étape 3 — Post-incident (après retour en ligne)

1. Test `/health` retourne 200
2. Test login admin sur `app.aurel-academy.com`
3. Vérifier que les leads des dernières heures sont bien dans le Sheet (Apps Script tourne indépendamment de Supabase)
4. Post-mortem dans `docs/post-mortems/`

### Étape 4 — Si l'incident dure > 4h

**Plan B : restore depuis backup hebdomadaire**

1. Va sur [https://github.com/emirmesbah-cloud/PLATFORME-COURS/actions/workflows/backup-supabase.yml](https://github.com/emirmesbah-cloud/PLATFORME-COURS/actions/workflows/backup-supabase.yml)
2. Trouve le dernier run successful → télécharge l'artifact `aurel-backup-*.sql.gz`
3. Crée un **NOUVEAU projet Supabase** (Frankfurt) en attendant
4. Note le nouveau Project Ref + DB password
5. Restore :
   ```bash
   gunzip aurel-backup-*.sql.gz
   psql "postgresql://postgres.<NEW_REF>:<NEW_PWD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres" < aurel-backup-*.sql
   ```
6. Update les secrets GitHub + Cloudflare Pages env vars vers le nouveau projet
7. Redeploy frontend (push commit vide)
8. Update Apps Script Google Sheets si besoin

⚠️ Cette procédure perd les données depuis le dernier backup (max 7 jours). À documenter dans le post-mortem.

---

## Scénario 2 — Resend SMTP / domaine blacklisté

**Symptômes** :
- Étudiants se plaignent de ne pas recevoir email d'activation / reset password
- Sentry alerte "Resend API error spike"
- Resend dashboard montre des bounces / spam complaints élevés

### Étape 1 — Diagnostic (5 min)

1. [https://resend.com/emails](https://resend.com/emails) — check les derniers envois
2. Pour chaque email échoué, note le `error.code` :
   - `bounced` (hard bounce) : adresse email invalide
   - `delivery_delay` : temporaire, attendre
   - `spam_complaint` : un destinataire a marqué comme spam
   - `delivered_failed` : problème côté domain

3. Check ta réputation :
   - [https://postmaster.google.com/managedomains](https://postmaster.google.com/managedomains) (Gmail postmaster)
   - [https://mxtoolbox.com/blacklists.aspx](https://mxtoolbox.com/blacklists.aspx) → tape `aurel-academy.com`

### Étape 2 — Si bounces > 5%

Tu envoies trop à des emails morts. Faut nettoyer ta liste :

```sql
-- Sur Supabase SQL Editor
-- Liste les users avec emails probables morts (jamais loggés depuis 30j)
SELECT id, email, last_login_at FROM profiles
WHERE last_login_at IS NULL OR last_login_at < NOW() - INTERVAL '30 days'
ORDER BY created_at;
```

→ Considère revoke / dormant ces users. Pause les emails marketing.

### Étape 3 — Si spam complaint > 0.1%

🔴 **Critique.** Resend va te suspendre.

1. Identifie quel type d'email pose problème (signup ? marketing ? rappel ?)
2. Pause cette catégorie d'emails immédiatement
3. Améliore le contenu (moins commercial, opt-out clair)
4. Réactive après 7-14 jours avec contenu propre

### Étape 4 — Si domaine blacklisté

🔴 **Très critique.** Tes emails partent direct en spam partout.

1. Identifie la blacklist via mxtoolbox
2. Suis la procédure de delisting de chaque RBL
3. **En attendant** : envoie depuis un domaine secondaire (ex `aurel-academy.email` ou via Resend onboarding subdomain)
4. Patch le `RESEND_FROM_EMAIL` dans Supabase Auth :
   ```bash
   curl -X PATCH "https://api.supabase.com/v1/projects/dvrqtqghgaxhhgkoihcj/config/auth" \
     -H "Authorization: Bearer $SUPABASE_PAT" \
     -H "Content-Type: application/json" \
     -d '{"smtp_admin_email": "noreply@aurel-academy.email"}'
   ```

### Étape 5 — Plan B email

Si Resend totalement down → switch vers **Postmark** ou **Brevo** (préparer un compte secondaire en dormant pour switch < 1h).

---

## Scénario 3 — Service_role key (ou PAT) compromise

**Symptômes** :
- Activité anormale dans la DB (rows ajoutées/modifiées que tu n'as pas faites)
- Sentry alerte "unauthorized DB access pattern"
- gitleaks workflow rouge sur un commit récent
- Email Supabase "Suspicious activity detected"

### Étape 1 — Confirmer la fuite (2 min)

1. Vérifie l'origine :
   - Si gitleaks alerte → check le commit identifié, copie la clé exposée
   - Sinon → check les logs Supabase Auth/DB pour activité suspecte

2. Identifie LAQUELLE des clés est compromise :
   - `SUPABASE_SERVICE_ROLE_KEY` (sb_secret_* ou eyJ...)
   - `SUPABASE_PAT` (sbp_*)
   - `RESEND_API_KEY` (re_*)
   - `FTP_PASSWORD` (cPanel)

### Étape 2 — Rotation immédiate (10 min)

#### Si service_role compromis :
1. Va sur [https://supabase.com/dashboard/project/dvrqtqghgaxhhgkoihcj/settings/api](https://supabase.com/dashboard/project/dvrqtqghgaxhhgkoihcj/settings/api)
2. Section **Secret keys** → **Rotate** ou **Create new** + **Revoke** l'ancienne
3. Mets à jour les endroits qui l'utilisent :
   - `platform/scripts/.env` (local)
   - GitHub Secret `SUPABASE_SERVICE_ROLE_KEY` (github-actions)
   - Edge function vault (auto-injectée, devrait suivre)
4. Redeploy edge functions :
   ```bash
   gh workflow run deploy-edge-functions.yml -R emirmesbah-cloud/PLATFORME-COURS
   ```

#### Si PAT compromis :
1. [https://supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → **Revoke** le token
2. Génère-en un nouveau si besoin
3. Update GitHub Secret `SUPABASE_ACCESS_TOKEN`

#### Si Resend compromis :
1. [https://resend.com/api-keys](https://resend.com/api-keys) → **Revoke** la clé
2. Génère une nouvelle clé
3. Update Supabase Auth SMTP password via Management API ou UI
4. Update Supabase edge function secret `RESEND_API_KEY`
5. Update GitHub Secret si présent

#### Si FTP compromis :
1. cPanel → FTP Accounts → Change password sur `github@aurel-academy.com`
2. Update GitHub Secret `FTP_PASSWORD`
3. Update GitHub Action `deploy-ftp.yml` si besoin

### Étape 3 — Audit dégâts (30 min)

```sql
-- Liste les changements récents (24h) sur les tables critiques
SELECT table_name, action_tstamp_tx, action FROM admin_audit_logs
WHERE action_tstamp_tx > NOW() - INTERVAL '24 hours'
ORDER BY action_tstamp_tx DESC;

-- Profiles créés récemment
SELECT * FROM profiles WHERE created_at > NOW() - INTERVAL '24 hours';

-- Codes activation utilisés récemment
SELECT * FROM activation_codes WHERE used_at > NOW() - INTERVAL '24 hours';
```

### Étape 4 — Si dégâts confirmés

1. **Restore depuis backup** (cf. Scénario 1, étape 4)
2. Notifier les utilisateurs affectés (emails compromis ?)
3. Post-mortem détaillé
4. Renforcer : ajouter 2FA sur tous les comptes admin (GitHub, Cloudflare, Supabase, Resend)

### Étape 5 — Prévention permanent

1. Vérifier que `gitleaks` workflow est bien activé sur les 2 repos
2. Audit périodique : `gh secret list -R emirmesbah-cloud/PLATFORME-COURS`
3. Rotation programmée des PATs tous les 90 jours
4. Jamais de secret dans le code (toujours via env / GitHub Secrets / Supabase Vault)

---

## 📚 Annexes

### Backups disponibles

- **GitHub Actions artifacts** : 90 jours rolling — [https://github.com/emirmesbah-cloud/PLATFORME-COURS/actions/workflows/backup-supabase.yml](https://github.com/emirmesbah-cloud/PLATFORME-COURS/actions/workflows/backup-supabase.yml)
- **Supabase native** : 7 jours rolling (Free tier) — [https://supabase.com/dashboard/project/dvrqtqghgaxhhgkoihcj/database/backups](https://supabase.com/dashboard/project/dvrqtqghgaxhhgkoihcj/database/backups)

### Rollback frontend

```bash
# Sur le repo PLATFORME-COURS
git log --oneline -10                           # repère le commit d'avant le bug
git revert <commit-fautif>                      # crée un revert
git push origin main                            # Cloudflare redeploy auto en 2-3 min
```

### Rollback site marketing (cPanel)

Le FTP deploy ne supprime pas les fichiers, donc rollback = revert le commit + push :
```bash
cd public_html
git revert <commit-fautif>
git push origin main                            # lftp redeploy 3 min
```

### Forcer logout de tous les utilisateurs

Si tu suspectes une fuite massive ou si tu veux rotate les sessions :
```sql
-- Reset toutes les sessions actives → tout le monde se reconnecte au prochain refresh
UPDATE profiles SET current_session_id = gen_random_uuid();
```

### Forcer un user spécifique à se déconnecter

```sql
SELECT admin_revoke_user('<user_uuid>', 'Manual logout request');
-- Puis pour le réactiver :
SELECT admin_unrevoke_user('<user_uuid>');
```

---

## 🛡️ Règle d'or pour les futures migrations RLS

> **Lesson learned** : la migration 009 a shipped en prod avec une policy RLS
> récursive qui a bloqué tous les users pendant ~30 min (fix dans 010).
> Pour ne plus jamais refaire l'erreur, ces règles s'appliquent à **toute**
> migration touchant aux RLS policies.

### ❌ À ne JAMAIS faire dans une RLS policy de table `X`

```sql
-- INTERDIT : sub-SELECT vers la même table dans USING/WITH CHECK
CREATE POLICY "..." ON profiles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.is_admin)
  );
-- → Provoque "infinite recursion detected in policy for relation profiles"
```

### ✅ À toujours faire à la place

Encapsuler le check dans une fonction `SECURITY DEFINER STABLE` qui **bypasse
RLS** par design :

```sql
CREATE OR REPLACE FUNCTION is_admin(user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER  -- ← BYPASS RLS
STABLE             -- ← optimisation planner
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = user_id), FALSE);
$$;

CREATE POLICY "Admins read all profiles" ON profiles
  FOR SELECT USING (is_admin(auth.uid()));
```

### Checklist avant de push une migration RLS

1. [ ] Lue avec attention : aucune policy ne fait `SELECT FROM <même_table>` dans `USING` / `WITH CHECK`
2. [ ] Tous les checks cross-row passent par une fonction `SECURITY DEFINER STABLE`
3. [ ] La migration tourne sans erreur sur la prod (output `[]` ou les RETURNING attendus)
4. [ ] **Smoke test** : appeler `/functions/v1/smoke-test` et vérifier `ok: true` sur tous les checks
5. [ ] Si smoke test échoue → `git revert` immédiat + push hot-fix migration

### Smoke test post-migration (automatique)

```bash
curl -X POST "https://dvrqtqghgaxhhgkoihcj.supabase.co/functions/v1/smoke-test?secret=$CRON_SECRET"
# → ok: true partout = on peut respirer
# → ok: false = Telegram alert déjà parti, fix immédiat
```

Le smoke test couvre :
- `auth.signIn` (auth flow)
- `select_own_profile` (RLS read)
- `select_lessons` (table secondaire)
- `rpc_verify_session` + `rpc_admin_get_stats` (RPCs critiques)
- `insert_progress` (RLS write avec upsert)

Si une de ces 6 vérifs casse, le smoke test push une alerte Telegram critique
et retourne 500 → le déploiement est invalidé.

---

## 🔄 V2 — Scénarios à ajouter post-launch

- Scénario 4 : Cloudflare Pages deploy fail
- Scénario 5 : VDOCipher OTP signing fail (vidéos inaccessibles)
- Scénario 6 : Apps Script Google quotas atteints
- Scénario 7 : Domaine `aurel-academy.com` expiré ou DNS down
- Scénario 8 : Bug RLS (étudiant accède aux données d'un autre)
- Scénario 9 : Attaque DDoS / brute force login
- Scénario 10 : GDPR / RGPD request d'un user (export, delete)
