# GitHub Actions — PLATFORME-COURS

3 workflows CI/CD :

## 🛡️ `ci.yml`
**Trigger** : push/PR sur `app/**`
**Job** : typecheck TypeScript + build Vite avec env placeholders → upload `dist/` en artifact (rétention 7j)
**Bloque le merge** si build échoue.

## 🚀 `deploy-edge-functions.yml`
**Trigger** : push sur `main` qui touche `supabase/functions/**` ou `supabase/config.toml`
**Job** : `supabase functions deploy activate-account --no-verify-jwt`
**Secrets requis** : `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`

## 📜 `deploy-migrations.yml`
**Trigger** : push sur `main` qui touche `supabase/migrations/**`
**Job** : `supabase link` + `supabase db push` → applique les nouvelles migrations
**Secrets requis** : `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`

⚠️ **Concurrence** : `cancel-in-progress: false` pour éviter de couper une migration en cours.

## 🔐 Setup secrets

Voir [`SECRETS.md`](./SECRETS.md) pour la procédure d'ajout des secrets dans GitHub.

## 🌐 Cloudflare Pages
Le déploiement du frontend `app/` n'utilise PAS GitHub Actions. Il est
configuré côté **Cloudflare Pages dashboard** (auto-deploy sur push).
Voir `app/README.md` section "Déploiement Cloudflare Pages".
