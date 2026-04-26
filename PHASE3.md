# Phase 3 — Features avancées + Polish

Cette phase ajoute les features qui font passer la plateforme du MVP au produit
premium : notes par leçon, certificat PDF auto-généré, emails transactionnels,
analytics admin, audit trail, modération feedback, export CSV.

## ✨ Nouvelles features

### Étudiant
- **Notes personnelles par leçon** — auto-save toutes les 3s (table `lesson_notes`)
- **Certificat PDF** automatiquement émis quand les 18 leçons sont complétées,
  téléchargeable depuis `/certificat`
- **Page feedback** `/feedback` — note 1-5, témoignage, recommandation, opt-in publication

### Admin
- **`/admin/analytics`** — 6 sections : KPIs engagement, courbe acquisition,
  minutes visionnées, funnel par leçon, distribution notes feedback, NPS,
  top 10 engagés / top 10 rapides (graphiques Recharts)
- **`/admin/feedback`** — modération des avis, toggle approbation publique
- **`/admin/emails`** — log de tous les emails transactionnels envoyés
- **`/admin/audit`** — journal de toutes les actions admin sensibles
- **Export CSV** des étudiants depuis `/admin/students`

### Backend
- **5 nouvelles tables** : `lesson_notes`, `certificates`, `feedback`, `email_logs`, `admin_audit_logs`
- **3 nouvelles RPC** : `check_and_issue_certificate`, `log_admin_action`, `admin_get_advanced_analytics`
- **Trigger DB** : `lesson_progress` complete → check certificate auto
- **2 Edge Functions** :
  - `send-email` — envoi via Resend + log
  - `check-inactive-users` — cron quotidien rappel 7 jours

## 🛠️ Setup Phase 3

### 1. Appliquer la migration SQL

Dans le SQL Editor Supabase, exécute :
```
supabase/migrations/20260427000007_phase3_features.sql
```

Vérifie ensuite avec :
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
-- 11 tables au total :
-- activation_codes, admin_audit_logs, bonus_downloads, bonus_resources,
-- certificates, email_logs, feedback, lesson_notes, lesson_progress,
-- lessons, profiles
```

### 2. Configurer Resend

1. Crée un compte sur **[resend.com](https://resend.com)** (gratuit, 3000 emails/mois)
2. **Domains → Add domain** → `aurel-academy.com`
3. Resend te donne 3 records DNS à ajouter (SPF, DKIM, MX)
4. **Verify** une fois les DNS propagés (5 min - 24h)
5. Génère une **API key** avec permission "Sending access"
6. Stocke dans Supabase :
   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxx --project-ref dvrqtqghgaxhhgkoihcj
   supabase secrets set RESEND_FROM_EMAIL="Aurel Academy <noreply@aurel-academy.com>" --project-ref dvrqtqghgaxhhgkoihcj
   supabase secrets set RESEND_REPLY_TO="aurel@aurel-academy.com" --project-ref dvrqtqghgaxhhgkoihcj
   supabase secrets set CRON_SECRET="$(openssl rand -hex 32)" --project-ref dvrqtqghgaxhhgkoihcj
   ```

### 3. Déployer les Edge Functions

```bash
supabase functions deploy send-email           --project-ref dvrqtqghgaxhhgkoihcj
supabase functions deploy check-inactive-users --project-ref dvrqtqghgaxhhgkoihcj
```

### 4. Setup la cron quotidienne

Dans Supabase Dashboard → **Database → Extensions** → active `pg_cron` et `pg_net`.

Puis dans le SQL Editor :
```sql
ALTER DATABASE postgres SET app.cron_secret TO 'TON_CRON_SECRET_ICI';

SELECT cron.schedule(
  'check-inactive-users-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dvrqtqghgaxhhgkoihcj.supabase.co/functions/v1/check-inactive-users',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    )
  );
  $$
);
```

## 📋 Tests de validation Phase 3

### Test 1 — Notes par leçon
1. Étudiant ouvre `/lecons/3` → onglet **Notes**
2. Écris du texte → attends 3s → toast "Notes sauvegardées"
3. Quitte, reviens → notes persistent

### Test 2 — Certificat PDF
1. Marque manuellement 18 leçons completed (SQL ci-dessous)
2. Trigger DB crée auto le certificat
3. `/certificat` → numéro `AUREL-2026-XXXX` + bouton Download PDF

```sql
INSERT INTO lesson_progress (user_id, lesson_id, completed, watched_seconds, last_position_seconds)
SELECT 'TON_USER_ID'::uuid, id, true, duration_minutes * 60, duration_minutes * 60
FROM lessons
ON CONFLICT (user_id, lesson_id) DO UPDATE SET completed = true;
```

### Test 3 — Feedback
1. Étudiant `/feedback` → 5★ + témoignage + recommande + public OK → submit
2. Admin `/admin/feedback` → "En attente" → clic **Approuver**

### Test 4 — Analytics
1. Admin `/admin/analytics`
2. 6 sections s'affichent (engagement, acquisition, minutes, funnel, NPS, top 10)

### Test 5 — Audit
1. Admin génère 3 codes via `/admin/codes`
2. `/admin/audit` → ligne `code_generated` avec metadata `{count: 3, codes: [...]}`

### Test 6 — Email Welcome (manuel)
```bash
curl -X POST https://dvrqtqghgaxhhgkoihcj.supabase.co/functions/v1/send-email \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "email_type": "welcome",
    "to": "ton@email.com",
    "vars": { "first_name": "Test" }
  }'
```
Vérifie : réception email + `/admin/emails` → ligne `sent`.

## 🔮 TODO restant pour MVP premium complet

- Wire `welcome` email à la fin du flow `/activate` (modifier l'edge function activate-account ou ajouter un appel côté frontend après login)
- Wire `milestone_50` et `certificate_issued` aux triggers DB (via pg_net call à send-email)
- Wire `feedback_request` à un cron 3 jours après émission certificat
- Page publique `/verify/:certificate_number` pour vérification recruteur
- QR code dans le PDF certificat
- Détail étudiant admin (modal progression leçon par leçon)
