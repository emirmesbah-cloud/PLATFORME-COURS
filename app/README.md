# Aurel Academy — Espace étudiant + Admin Panel (Phase 2)

Frontend React/Vite/Tailwind pour la plateforme étudiant
[`app.aurel-academy.com`](https://app.aurel-academy.com).

Backend = Supabase (Phase 1) — ce front consomme les RPC, RLS et l'edge
function `activate-account` déjà déployées.

---

## 📦 Stack

- Vite 5 + React 18 + TypeScript
- TailwindCSS + composants maison (style shadcn-like, sans dépendance CLI)
- React Router v6 (browser router, compatible Cloudflare Pages SPA)
- TanStack Query v5 (data fetching + cache)
- React Hook Form + Zod (validation forms)
- Supabase JS v2 (auth + RPC + Storage)
- Lucide React (icônes)

---

## 🗂️ Structure

```
app/
├── public/
│   ├── _redirects              ← SPA fallback Cloudflare Pages
│   ├── _headers                ← Headers de sécurité
│   └── favicon.svg
├── src/
│   ├── main.tsx
│   ├── App.tsx                 ← Providers (Query, Auth, Toast, Router)
│   ├── routes.tsx
│   ├── index.css               ← Tailwind + classes utilitaires brand
│   ├── components/
│   │   ├── ui/                 ← Toast, Spinner, Modal, Switch, Progress
│   │   ├── layout/             ← StudentLayout, AdminLayout
│   │   ├── features/           ← AurelLogo, LessonCard, BonusCard, VideoPlayer
│   │   └── guards/             ← AuthGuard, AdminGuard, RootRedirect
│   ├── hooks/
│   │   └── useAuth.tsx         ← Context Auth + profile
│   ├── lib/
│   │   ├── supabase.ts         ← Client init
│   │   ├── types.ts            ← Types TS (1:1 avec schema Phase 1)
│   │   ├── queries.ts          ← Queries + RPC wrappers
│   │   └── utils.ts            ← cn(), formats, regex
│   └── pages/
│       ├── public/             ← Login, Activate, ForgotPassword
│       ├── student/            ← Dashboard, Lessons, LessonDetail, Bonus, Profile
│       └── admin/              ← AdminDashboard, AdminCodes, AdminStudents, AdminLessons, AdminBonus
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── index.html
└── .env.example
```

---

## ⚙️ Setup local

### 1. Pré-requis

- Node.js 18 ou plus
- Migration Phase 1.5 (`20260426000006_admin_role.sql`) appliquée sur le projet Supabase
- Edge Function `activate-account` déployée (Phase 1, étape E)

### 2. Configuration

```bash
cd app
cp .env.example .env.local
```

Édite `.env.local` :

```
VITE_SUPABASE_URL=https://dvrqtqghgaxhhgkoihcj.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxx
VITE_VDOCIPHER_API_KEY=placeholder
```

> La clé `VITE_SUPABASE_ANON_KEY` est la **Publishable key** (publique).
> Ne jamais utiliser la Secret key côté frontend.

### 3. Installation

```bash
npm install --legacy-peer-deps
```

> `--legacy-peer-deps` évite des conflits de peer-deps inoffensifs entre vite/plugin-react.

### 4. Dev server

```bash
npm run dev
```

Ouvre [http://localhost:5173](http://localhost:5173).

### 5. Build production

```bash
npm run build
# Output dans app/dist/
```

---

## 🔐 Setup admin (Aurel) — manuel, une fois

1. Génère un code Accompagné via le script CLI (Phase 1) :
   ```bash
   cd ../scripts
   node generate-codes.js --tier=accompagne --count=1 --notes="Compte admin Aurel"
   ```
2. Sur `app.aurel-academy.com/activate`, Aurel s'active normalement avec
   son email.
3. Va sur le **Supabase Dashboard → Table Editor → `profiles`**.
4. Cherche la row d'Aurel (par email) → édite `is_admin` → `true`.
5. Sauvegarde. Aurel se reconnecte → il voit le lien **Admin** dans
   le header et peut accéder à `/admin/*`.

> ⚠️ Ne JAMAIS exposer un signup admin public. Le seul moyen de devenir admin
> est de muter `is_admin = true` via le service_role (Dashboard ou script).
> Le trigger `protect_profile_immutable_fields` empêche tout user
> authentifié de s'auto-promouvoir.

---

## 🚀 Déploiement Cloudflare Pages

### A. Lier le repo

1. Va sur **[Cloudflare Pages](https://dash.cloudflare.com/?to=/:account/pages)** → **Create a project** → **Connect to Git**.
2. Sélectionne ton repo (push d'abord ce dossier `app/` sur GitHub si pas fait).
3. Branche : `main` (ou ce que tu veux pour la prod).

### B. Build settings

| Champ                    | Valeur                                        |
|--------------------------|-----------------------------------------------|
| Project name             | `aurel-academy-app`                           |
| Production branch        | `main`                                        |
| Framework preset         | **Vite**                                      |
| Build command            | `npm install --legacy-peer-deps && npm run build` |
| Build output directory   | `dist`                                        |
| Root directory (advanced)| `app`  *(si le repo contient le dossier app/)* |
| Environment variables    | Voir ci-dessous                               |

### C. Variables d'environnement (Production)

```
VITE_SUPABASE_URL=https://dvrqtqghgaxhhgkoihcj.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxx
VITE_VDOCIPHER_API_KEY=placeholder
NODE_VERSION=20
```

### D. Domaine custom

1. Page **Custom domains** du projet Cloudflare Pages → **Set up a custom domain**.
2. Saisis `app.aurel-academy.com`.
3. Cloudflare crée automatiquement un record CNAME.
4. Si ton DNS est ailleurs (Octenium, OVH, etc.), ajoute le CNAME suggéré côté DNS.
5. Cloudflare provisionne le SSL automatiquement (~1 min).

### E. Vérifier le déploiement

- Ouvre `https://app.aurel-academy.com/login`
- L'app doit charger, le formulaire doit s'afficher.
- Tente une activation avec un vrai code → redirect `/dashboard`.
- Si admin → `/admin/codes` doit fonctionner et générer des codes.

---

## 🧪 Tests de validation Phase 2

### Test 1 — Activation étudiant

1. Aurel se connecte sur `/login` (compte admin).
2. Va sur `/admin/codes` → génère 1 code Autonome avec note "Test 1".
3. Modal affiche `AU-XXXX` + "Copier message WhatsApp".
4. Ouvre une nav privée → `/activate` → saisit le code + infos test.
5. Compte créé → redirect `/dashboard`.
6. Voir 18 leçons (toutes "Bientôt" tant que `vdocipher_video_id` vide) + 7 bonus.

### Test 2 — Login + dashboard

1. `/login` avec credentials test.
2. Dashboard → 0% progression, derniers items vides.
3. Cliquer une leçon → `/lecons/1` → player placeholder "Cette leçon arrive très bientôt".

### Test 3 — Admin codes

1. Admin se connecte.
2. `/admin/codes` → génère 5 codes Accompagné avec note "Promo".
3. Modal affiche les 5 codes en monospace + 2 boutons copier.
4. Bouton "Copier message WhatsApp" → message formaté avec `https://app.aurel-academy.com/activate`.
5. Table historique montre les 5 codes neufs en haut, statut "Disponible".
6. Filtre tier=Accompagné → ne montre que ces codes.

### Test 4 — Sécurité admin

1. Étudiant test ouvre `https://app.aurel-academy.com/admin` → redirect `/dashboard` + toast "Accès refusé".
2. Le compte admin accède sans souci.
3. Côté DB, un étudiant qui tente `UPDATE profiles SET is_admin=TRUE WHERE id=auth.uid()` → bloqué par le trigger (Phase 1.5).

### Test 5 — Bonus download

1. Étudiant clique "Télécharger" sur un bonus.
2. Si `file_url` est null → toast "Bientôt disponible".
3. Sinon → ouverture du fichier via signed URL + row insérée dans `bonus_downloads`.

---

## 🔌 Architecture data

### Auth flow

1. `<AuthProvider>` écoute `supabase.auth.onAuthStateChange()`.
2. À chaque session valide, charge le profile via `SELECT * FROM profiles WHERE id = auth.uid()`.
3. Expose `{ session, user, profile, isAdmin, isLoading, signOut, refreshProfile }`.
4. `<AuthGuard>` redirige vers `/login` si pas de session, vers `/activate` si session sans profile.
5. `<AdminGuard>` redirige vers `/dashboard` si non-admin (avec toast).

### Activation flow

1. User soumet `/activate` → `fetch(POST /functions/v1/activate-account)` avec apikey publique.
2. Edge function (Phase 1) : valide code → `auth.admin.createUser` → `signInWithPassword` →
   `redeem_activation_code` (RPC SECURITY DEFINER) → retourne `{ user, session }`.
3. Le client appelle `supabase.auth.setSession(...)` → `<AuthProvider>` réagit et charge le profile.
4. Redirect `/dashboard`.

### Progression vidéo

1. `<VideoPlayer>` instancie un iframe VDOCipher.
2. Toutes les 10s, appel `update_lesson_progress(lesson_id, watched_seconds, position_seconds)`.
3. Au unmount, flush final.
4. La RPC marque `completed = true` quand `watched_seconds ≥ 90% × duration_minutes × 60`.

> NOTE Phase 2 → Phase 3 : le tracking actuel utilise un timer rough basé sur le
> temps passé sur la page. Pour un tracking précis (pause/resume, scrubbing),
> brancher la VDOCipher player.js SDK avec postMessage events.

### Génération de codes (admin panel)

`/admin/codes` appelle `admin_generate_codes(tier, count, notes)` (RPC SECURITY DEFINER,
vérifie `is_admin(auth.uid())`). Pas besoin du service_role côté frontend.

---

## 🎨 Branding

- **Couleurs** définies dans `tailwind.config.js` :
  - `aurel-orange` : `#F97316` (primaire)
  - `aurel-orange-dark` : `#EA580C` (hover)
  - `aurel-orange-soft` : `#FFEDD5` (badges, fond doux)
  - `aurel-teal` : `#0D7377` (accents secondaires, admin)
  - `aurel-dark` : `#0A1628` (bg admin header, hero placeholder)
  - `aurel-ink` : `#1A1A1A` (texte principal)
- **Fonts** : Calibri (body) + Georgia italic (`.font-serif-italic` ou `font-serif italic`)
- **Logo** : `<AurelLogo />` cercle orange + texte "Aurel Academy" (Academy en italique)

---

## 🔧 Routes

| Route                         | Accès        | Composant                  |
|-------------------------------|--------------|----------------------------|
| `/`                           | Public       | `<RootRedirect />`         |
| `/login`                      | Public       | `<LoginPage />`            |
| `/activate`                   | Public       | `<ActivatePage />`         |
| `/forgot-password`            | Public       | `<ForgotPasswordPage />`   |
| `/dashboard`                  | Étudiant auth| `<StudentDashboard />`     |
| `/lecons`                     | Étudiant auth| `<StudentLessons />`       |
| `/lecons/:lessonNumber`       | Étudiant auth| `<StudentLessonDetail />`  |
| `/bonus`                      | Étudiant auth| `<StudentBonus />`         |
| `/profil`                     | Étudiant auth| `<StudentProfile />`       |
| `/admin`                      | Admin only   | `<AdminDashboard />`       |
| `/admin/codes`                | Admin only   | `<AdminCodes />`           |
| `/admin/students`             | Admin only   | `<AdminStudents />`        |
| `/admin/lessons`              | Admin only   | `<AdminLessons />`         |
| `/admin/bonus`                | Admin only   | `<AdminBonus />`           |

---

## 🐛 Troubleshooting

### `npm install` échoue avec ERR_SSL_CIPHER_OPERATION_FAILED

Connu sur Node 24 + certains réseaux. Workarounds :
1. `npm cache clean --force` puis `npm install --legacy-peer-deps --fetch-retries=5`
2. Utiliser **pnpm** : `npm i -g pnpm && pnpm install`
3. Downgrade Node à **v20 LTS**

### "Missing VITE_SUPABASE_URL" en console

Tu n'as pas de `.env.local` ou il est mal nommé.
- Vite ne lit que les fichiers `.env`, `.env.local`, `.env.development.local` (pas `.env.dev`).
- Restart le dev server après création du fichier.

### Le toast d'erreur affiche "Accès refusé" en boucle sur /admin

Tu n'as pas mis `is_admin = true` sur ton profile (étape Setup admin).

### Les leçons sont toujours "Bientôt"

Tant que `lessons.vdocipher_video_id` est NULL ou `is_published = false`, la
leçon est marquée comme bientôt disponible. Va dans `/admin/lessons` pour
renseigner les video IDs et publier.

### Le signup public est volontairement absent

Pas de `<SignupPage />` : la seule façon de créer un compte est via un code
d'activation (envoyé par WhatsApp après paiement). C'est le design choisi.

---

## ⏭️ Roadmap Phase 3 (hors scope ici)

- Notes de leçon persistées (table `lesson_notes`)
- VDOCipher player.js SDK pour tracking précis (pause/resume/scrubbing)
- Édition profile : photo de profil
- Notifications email (nouvelle leçon publiée, etc.)
- Export CSV étudiants admin
- Détail étudiant admin (modal avec progression leçon par leçon)
- Mode dark
