# Aurel Academy — Backend Supabase (Phase 1)

Backend de la plateforme étudiant `app.aurel-academy.com`. PostgreSQL +
Supabase Auth + Row Level Security. Pas de frontend dans cette phase.

---

## Sommaire

1. [Stack](#stack)
2. [Structure du repo](#structure-du-repo)
3. [Setup initial du projet Supabase](#setup-initial-du-projet-supabase)
4. [Application des migrations](#application-des-migrations)
5. [Edge Function `activate-account`](#edge-function-activate-account)
6. [Script `generate-codes.js`](#script-generate-codesjs)
7. [Schéma & API](#schéma--api)
8. [Tests de validation Phase 1](#tests-de-validation-phase-1)
9. [Variables d'environnement](#variables-denvironnement)

---

## Stack

| Couche       | Choix                                                       |
|--------------|-------------------------------------------------------------|
| DB           | PostgreSQL (Supabase Free tier, région Frankfurt)           |
| Auth         | Supabase Auth — email + password (autres providers OFF)     |
| Sécurité     | Row Level Security activé sur toutes les tables             |
| Storage      | Buckets Supabase Storage (`bonus-resources`, `lesson-thumbnails`) |
| Vidéo        | VDOCipher (champ DB, intégration Phase 2)                   |
| Frontend     | Cloudflare Pages + React + Vite + shadcn/ui (Phase 2)       |

---

## Structure du repo

```
supabase/
├── README.md                                  ← ce fichier
├── migrations/
│   ├── 20260426000001_initial_schema.sql      ← types, tables, RLS, policies
│   ├── 20260426000002_seed_lessons.sql        ← 18 leçons (ordre canonique)
│   ├── 20260426000003_seed_bonus.sql          ← 7 ressources bonus
│   ├── 20260426000004_rpc_functions.sql       ← 5 fonctions RPC
│   └── 20260426000005_storage.sql             ← buckets + policies
└── functions/
    └── activate-account/
        └── index.ts                           ← edge function (TypeScript/Deno)

scripts/
├── generate-codes.js                          ← CLI Node pour codes d'activation
├── package.json
├── .env.example
└── .gitignore
```

---

## Setup initial du projet Supabase

1. Crée un nouveau projet sur [supabase.com](https://supabase.com) :
   - Nom : `aurel-academy-platform`
   - Région : **Frankfurt (eu-central-1)**
   - Plan : Free
   - Note bien le `Project URL`, l'`anon key` et le `service_role key`.

2. **Auth** → Providers :
   - Email : ON
   - **"Confirm email"** : ON  *(les confirmations sont gérées côté edge
     function via `email_confirm: true`, donc pas d'email envoyé en pratique)*
   - Tous les autres providers : OFF.

3. **Auth** → URL Configuration :
   - Site URL : `https://app.aurel-academy.com`
   - Redirect URLs : `https://app.aurel-academy.com/**`

---

## Application des migrations

### Option A — CLI Supabase (recommandée)

```bash
# 1. Installe la CLI
npm i -g supabase

# 2. Login
supabase login

# 3. Lie ton projet local au projet distant
supabase link --project-ref <your-project-ref>

# 4. Pousse les migrations
supabase db push
```

### Option B — SQL Editor (manuelle)

Dans le dashboard Supabase → **SQL Editor** → ouvre chaque fichier dans l'ordre
et exécute :

1. `20260426000001_initial_schema.sql`
2. `20260426000002_seed_lessons.sql`
3. `20260426000003_seed_bonus.sql`
4. `20260426000004_rpc_functions.sql`
5. `20260426000005_storage.sql`

Chaque migration termine par un sanity-check qui lève une exception si le seed
n'a pas le bon nombre de rows. Si une exception est levée, l'erreur indique la
ligne fautive.

---

## Edge Function `activate-account`

### Pourquoi une Edge Function et pas une RPC SQL ?

Le brief décrit `activate_account(code, email, password, first_name, last_name, whatsapp)`
qui crée un `auth.users`. **PostgreSQL ne peut pas appeler `supabase.auth.signUp`
directement** (l'API d'auth vit hors de Postgres). On implémente donc le flow
en deux couches :

- **Edge Function** : fait le `auth.admin.createUser` + `signInWithPassword`,
  puis appelle la RPC `redeem_activation_code` avec le JWT du nouvel user.
- **RPC SQL `redeem_activation_code`** : valide le code, crée le profile,
  marque le code utilisé. Atomique, scoped à `auth.uid()`.

Si l'edge function échoue à la dernière étape (redeem), le user fraîchement
créé est rollback (`auth.admin.deleteUser`).

### Déploiement

```bash
# Depuis la racine du repo
supabase functions deploy activate-account
```

L'URL finale : `https://<project-ref>.supabase.co/functions/v1/activate-account`

### Appel depuis le frontend

```ts
const r = await fetch(
  `${SUPABASE_URL}/functions/v1/activate-account`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      code:       'AU-1234',
      email:      'sara@example.com',
      password:   'min8chars',
      first_name: 'Sara',
      last_name:  'Benali',
      whatsapp:   '+213555000000',
    }),
  }
);
const data = await r.json();
// data = { ok: true, user: {...}, session: { access_token, ... } }
// → stocker la session côté client (supabase.auth.setSession)
```

### Codes d'erreur retournés

| Code                    | Signification                                       |
|-------------------------|-----------------------------------------------------|
| `MISSING_FIELDS`        | Un champ requis est vide                            |
| `EMAIL_INVALID`         | Format email invalide                               |
| `WEAK_PASSWORD`         | Mot de passe < 8 caractères                         |
| `CODE_INVALID`          | Code inexistant                                     |
| `CODE_ALREADY_USED`     | Code déjà utilisé par un autre user                 |
| `EMAIL_ALREADY_EXISTS`  | Cet email a déjà un compte                          |
| `REDEEM_FAILED`         | Échec lors du binding code↔user (rollback effectué) |
| `INTERNAL_ERROR`        | Bug serveur (voir `detail` pour le message)         |

---

## Script `generate-codes.js`

### Setup

```bash
cd scripts/
cp .env.example .env
# Édite .env et remplis SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
```

### Usage

```bash
# 10 codes Autonome
node generate-codes.js --tier=autonome --count=10

# 5 codes Accompagné avec note interne
node generate-codes.js --tier=accompagne --count=5 --notes="Promo lancement avril 2026"
```

### Sortie

```
═══════════════════════════════════════════════════════════
  10 code(s) Autonome (12 900 DA) généré(s)
═══════════════════════════════════════════════════════════

  AU-7831
  AU-3429
  AU-8102
  AU-2755
  ...

Activation : https://app.aurel-academy.com/activate
```

Tu copies/colles le code dans WhatsApp avec le lien d'activation.

### Note sur la cardinalité

Format `XX-NNNN` → 9 000 codes possibles par préfixe (1000–9999).
Largement suffisant pour démarrer ; passer à 5 chiffres si tu dépasses
~5000 codes pour rester safe sur les collisions.

---

## Schéma & API

### Tables

| Table              | Rôle                                                       |
|--------------------|------------------------------------------------------------|
| `activation_codes` | Codes générés par Aurel, envoyés par WhatsApp après paiement |
| `profiles`         | 1 row par user, créé via `redeem_activation_code`          |
| `lessons`          | Catalogue des 18 leçons (ordre canonique fixe)             |
| `lesson_progress`  | Progression vidéo par (user, leçon)                        |
| `bonus_resources`  | Catalogue des 7 ressources bonus                           |
| `bonus_downloads`  | Log des téléchargements (audit + futurs analytics)         |

### RLS — Résumé

| Table              | Policies                                                       |
|--------------------|----------------------------------------------------------------|
| `activation_codes` | RLS ON, **aucune policy** → réservé service_role/RPC           |
| `profiles`         | SELECT/UPDATE pour `auth.uid() = id` (+ trigger anti-tampering) |
| `lessons`          | SELECT pour `authenticated`                                    |
| `lesson_progress`  | ALL pour `auth.uid() = user_id`                                |
| `bonus_resources`  | SELECT pour `authenticated`                                    |
| `bonus_downloads`  | SELECT/INSERT pour `auth.uid() = user_id`                      |

### Fonctions RPC

| RPC                          | Auth requis | Retour                                        |
|------------------------------|-------------|-----------------------------------------------|
| `validate_activation_code`   | non         | `{ ok, tier? \| error }`                       |
| `redeem_activation_code`     | oui         | `{ ok, tier? \| error }` — appelé après signUp |
| `get_user_progress_summary`  | oui         | `{ total_lessons, completed_lessons, percentage_complete, total_watched_seconds, last_lesson_watched }` |
| `update_lesson_progress`     | oui         | `{ ok, completed, threshold_seconds }`        |
| `touch_last_login`           | oui         | `{ ok }` — mettre à jour `profiles.last_login_at` |

Codes d'erreur RPC : `CODE_INVALID`, `CODE_ALREADY_USED`, `NOT_AUTHENTICATED`,
`PROFILE_ALREADY_EXISTS`, `MISSING_FIELDS`, `LESSON_NOT_FOUND`, `LESSON_REQUIRED`.

### Storage

| Bucket              | Visibilité | Usage                                         |
|---------------------|------------|-----------------------------------------------|
| `bonus-resources`   | privé      | DOCX bonus, accès via signed URLs (1h)        |
| `lesson-thumbnails` | public     | vignettes leçons sur le dashboard             |

L'upload se fait via service_role (admin). La lecture des `bonus-resources`
se fait côté frontend en générant des signed URLs :

```ts
const { data } = await supabase.storage
  .from('bonus-resources')
  .createSignedUrl('glossaire-150-termes.docx', 3600);
// data.signedUrl → utilisable pour télécharger
```

---

## Tests de validation Phase 1

À exécuter dans l'ordre. Tu peux utiliser le **SQL Editor**, **curl**, ou
**Postman**.

> Remplace `<URL>` par ton `SUPABASE_URL`, `<ANON>` par ton anon key, et
> `<TOKEN>` par un access_token valide (récupéré via l'edge function ou
> `auth.signInWithPassword`).

### Test 1 — Génération d'un code

```bash
cd scripts/
node generate-codes.js --tier=autonome --count=1 --notes="Test validation"
# → AU-XXXX affiché en console
```

Vérifier dans le SQL Editor :
```sql
SELECT * FROM activation_codes ORDER BY created_at DESC LIMIT 1;
-- is_used = false, tier = autonome
```

### Test 2 — Activation complète via edge function

```bash
curl -X POST '<URL>/functions/v1/activate-account' \
  -H 'Content-Type: application/json' \
  -H 'apikey: <ANON>' \
  -d '{
    "code": "AU-XXXX",
    "email": "test1@example.com",
    "password": "supersecret123",
    "first_name": "Sara",
    "last_name": "Test",
    "whatsapp": "+213555000001"
  }'
```

Réponse attendue :
```json
{
  "ok": true,
  "user": { "id": "...", "email": "test1@example.com", "tier": "autonome", ... },
  "session": { "access_token": "...", "refresh_token": "...", ... }
}
```

Vérifications DB :
```sql
SELECT email, tier FROM profiles WHERE email = 'test1@example.com';
SELECT is_used, used_by_user_id FROM activation_codes WHERE code = 'AU-XXXX';
-- profile : tier='autonome'  /  code : is_used=true
```

### Test 3 — Lire les leçons (authentifié)

```bash
curl '<URL>/rest/v1/lessons?select=lesson_number,title&order=lesson_number' \
  -H 'apikey: <ANON>' \
  -H 'Authorization: Bearer <TOKEN>'
```

Doit retourner les **18 leçons dans l'ordre** `lesson_number 1 → 18`.

### Test 4 — Lire les leçons (non authentifié)

```bash
curl '<URL>/rest/v1/lessons?select=lesson_number,title' \
  -H 'apikey: <ANON>'
```

Doit retourner `[]` ou un 401/403 (RLS bloque).

### Test 5 — Lire les bonus (authentifié)

```bash
curl '<URL>/rest/v1/bonus_resources?select=order_index,name&order=order_index' \
  -H 'apikey: <ANON>' \
  -H 'Authorization: Bearer <TOKEN>'
```

Doit retourner les **7 bonus dans l'ordre** `order_index 1 → 7`.

### Test 6 — Bonus : code déjà utilisé

```bash
# Re-tente d'activer le même code AU-XXXX
curl -X POST '<URL>/functions/v1/activate-account' \
  -H 'Content-Type: application/json' \
  -H 'apikey: <ANON>' \
  -d '{ "code": "AU-XXXX", "email": "test2@example.com", "password": "supersecret123", "first_name": "X", "last_name": "Y", "whatsapp": "+213555000002" }'
# → { "ok": false, "error": "CODE_ALREADY_USED" }
```

---

## Variables d'environnement

### Frontend (Phase 2 — `.env.local`)

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_VDOCIPHER_API_KEY=placeholder
```

### Backend (Supabase Vault / scripts/.env)

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
VDOCIPHER_API_SECRET=placeholder
```

> **Le `service_role_key` ne doit JAMAIS être exposé côté frontend.**
> Il est utilisé uniquement dans :
> - `scripts/generate-codes.js` (local Node)
> - L'edge function `activate-account` (auto-injecté par Supabase)

---

## Ne pas faire (dérive scope Phase 1)

- ❌ Pas de frontend (Phase 2)
- ❌ Pas d'admin panel (Phase 3)
- ❌ Pas d'intégration VDOCipher concrète (juste le champ DB nullable)
- ❌ Pas de design / UI / composants
- ❌ Pas de modification du séquencing des 18 leçons ni des 7 bonus
