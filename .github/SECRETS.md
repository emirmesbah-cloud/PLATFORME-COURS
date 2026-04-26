# GitHub Secrets — PLATFORME-COURS

Pour que les workflows GitHub Actions fonctionnent, tu dois ajouter ces 3
secrets dans le repo :

→ **Repo Settings → Secrets and variables → Actions → New repository secret**

| Nom du secret              | Valeur                                                                     |
|----------------------------|----------------------------------------------------------------------------|
| `SUPABASE_PROJECT_REF`     | `dvrqtqghgaxhhgkoihcj`                                                     |
| `SUPABASE_ACCESS_TOKEN`    | Ton PAT (commence par `sbp_…`) — celui qu'on a créé pour la CLI            |
| `SUPABASE_DB_PASSWORD`     | Le mot de passe de la DB Supabase (Project Settings → Database → Reset si oublié) |

## 🔍 Comment récupérer chaque valeur

### `SUPABASE_PROJECT_REF`
Tu l'as déjà : `dvrqtqghgaxhhgkoihcj`. C'est l'ID du projet visible dans
l'URL du dashboard Supabase.

### `SUPABASE_ACCESS_TOKEN`
1. Va sur [https://supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
2. Si tu vois un PAT existant que tu utilises déjà → il est OK pour le CI/CD
3. Sinon → "Generate new token" → nomme-le `github-actions` → copie la valeur
   (qui commence par `sbp_…`) **immédiatement** car elle ne se réaffiche jamais.

### `SUPABASE_DB_PASSWORD`
1. Va sur [https://supabase.com/dashboard/project/dvrqtqghgaxhhgkoihcj/settings/database](https://supabase.com/dashboard/project/dvrqtqghgaxhhgkoihcj/settings/database)
2. Section **"Database password"**
3. Si tu te souviens du password initial → utilise-le
4. Sinon → bouton **"Reset database password"** → tu obtiens un nouveau
   password (à copier immédiatement)
5. ⚠️ **Important** : ce reset ne casse rien (le password DB est utilisé
   uniquement pour les connexions directes, pas pour les RPC ni l'edge function).

## ✅ Vérification

Une fois les 3 secrets ajoutés, push n'importe quoi qui touche
`supabase/migrations/` ou `supabase/functions/` → GitHub Actions doit
se déclencher dans l'onglet "Actions" du repo et passer au vert.

## 🛡️ Sécurité

- Les secrets sont chiffrés et **jamais visibles en logs**.
- Seuls les workflows ont accès aux secrets, pas les forks.
- Tu peux **rotater n'importe quel secret** à tout moment :
  1. Génère une nouvelle valeur côté Supabase
  2. Édite le secret dans GitHub Settings
  3. Le prochain push utilise la nouvelle valeur

## 🚫 Ce qui **n'a PAS besoin d'être en secret**

- `VITE_SUPABASE_URL` → public, set dans Cloudflare Pages env vars
- `VITE_SUPABASE_ANON_KEY` → publishable key, set dans Cloudflare Pages env vars
- `SUPABASE_SERVICE_ROLE_KEY` → **seulement** dans `scripts/.env` local
  (jamais en CI ; on n'en a pas besoin pour les workflows actuels)
