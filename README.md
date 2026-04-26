# Aurel Academy — Plateforme étudiant

Monorepo pour la plateforme **[app.aurel-academy.com](https://app.aurel-academy.com)** :
espace étudiant + admin panel + backend Supabase + outils CLI.

```
platform/
├── app/         → Frontend React (Vite + Tailwind) — déployé sur Cloudflare Pages
├── supabase/    → Migrations SQL + Edge Functions
└── scripts/     → CLI Node (générateur de codes d'activation)
```

## 🗺️ Architecture

```
┌─────────────────────────────────────────┐
│  Étudiant (navigateur)                  │
│  app.aurel-academy.com                  │
└─────────────────────────────────────────┘
                  ↕ HTTPS
┌─────────────────────────────────────────┐
│  app/  (React + Vite)                   │
│  Hébergé sur Cloudflare Pages           │
└─────────────────────────────────────────┘
                  ↕
┌─────────────────────────────────────────┐
│  supabase/                              │
│  - PostgreSQL + RLS                     │
│  - Edge Function activate-account       │
│  - Auth (email + password)              │
│  Region : Frankfurt                     │
└─────────────────────────────────────────┘
                  ↕
┌─────────────────────────────────────────┐
│  scripts/generate-codes.js              │
│  CLI Node (depuis ton PC, service_role) │
└─────────────────────────────────────────┘
```

## 🚀 Démarrage rapide

### Backend (Supabase)
Voir [`supabase/README.md`](./supabase/README.md) pour :
- Les 6 migrations SQL à appliquer
- Le déploiement de l'Edge Function `activate-account`
- Les tests de validation Phase 1

### Frontend (app)
Voir [`app/README.md`](./app/README.md) pour :
- Setup local avec `npm install` + `npm run dev`
- Variables d'environnement
- Déploiement Cloudflare Pages

### Scripts CLI
```bash
cd scripts
cp .env.example .env  # remplir SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm install
node generate-codes.js --tier=autonome --count=10
```

## 🔐 Variables d'environnement

| Variable                       | Où                          | Public ? |
|--------------------------------|-----------------------------|----------|
| `VITE_SUPABASE_URL`            | `app/.env.local`            | ✅ public |
| `VITE_SUPABASE_ANON_KEY`       | `app/.env.local`            | ✅ public |
| `SUPABASE_URL`                 | `scripts/.env`              | ✅ public |
| `SUPABASE_SERVICE_ROLE_KEY`    | `scripts/.env`              | ❌ **SECRET** |

> ⚠️ **JAMAIS** commit la `SUPABASE_SERVICE_ROLE_KEY` (elle bypasse toute la
> sécurité RLS). Le `.gitignore` racine exclut tous les `.env` et `.env.local`.

## 🛡️ Sécurité

- **RLS activé** sur toutes les tables Phase 1
- **`is_admin`** ne peut être muté que par le `service_role` (trigger DB Phase 1.5)
- Pas de signup public admin — promotion manuelle via Supabase Dashboard
- Edge Function `activate-account` rollback automatique si redeem échoue

## 🌐 Repo lié

Site web public (`aurel-academy.com`) → repo `sitewebaurelacademy`
