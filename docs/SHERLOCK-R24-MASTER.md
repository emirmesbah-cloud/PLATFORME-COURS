# Aurel Academy — Sherlock R24 Master Remediation Brief

> Self-contained diagnosis + fix spec for the security/reliability audit run on **2026-07-23**.
> Hand this whole file to an engineer or an AI agent to continue the work — every finding has
> its location, evidence, impact, and concrete fix. Nothing here depends on outside context.

---

## 0. System under audit

| | |
|---|---|
| **App** | React 18 + Vite + TypeScript + TailwindCSS, TanStack Query, react-router 6 |
| **Backend** | Supabase (project `dvrqtqghgaxhhgkoihcj`, Frankfurt) — Postgres + RLS, 11 Edge Functions, Storage |
| **Hosting** | Frontend on Cloudflare Pages (auto-deploy on push); marketing/static on cPanel |
| **Repo** | `emirmesbah-cloud/PLATFORME-COURS` (branch `main`, protected: PR + "TypeScript + Vite build" check) |
| **Local paths** | app: `platform/app` · functions/migrations: `platform/supabase` |
| **Secrets (local)** | `platform/scripts/.env` (SUPABASE_URL + SERVICE_ROLE_KEY) · `platform/app/.env.local` (VITE_* + VDOCIPHER key) |

**Two courses on one platform:**
- **Pflege** — live. 19 students, **all** `profiles.course_access = 'pflege'`. Videos in one VDOCipher account (`VDOCIPHER_API_KEY`).
- **Immigration** — built, not launched. **0** students, **0** activation codes ever issued. Content complete (61 lessons, 255 quiz questions). **40 videos already uploaded & `[ready]`** in a *separate* VDOCipher account (`VDOCIPHER_API_KEY_IMMIGRATION`). 21 lessons still have no video (Module 0 intros, Niches ×7, Tutos ×6, + 1.1/1.2/3.4/5.4).

**Root architectural fact (the through-line of this audit):** `profiles.course_access` is **single-valued** (`'pflege' | 'immigration'`, NOT NULL default `'pflege'`, CHECK-constrained). When Immigration was bolted on, **no server-side course isolation came with it** — `course_access` was referenced in **zero** RLS policies and **zero** edge functions. The two courses were separated only in the React UI, which any direct API call ignores. That single gap is the root of every Critical/High security finding.

---

## 1. How the diagnosis was made (methodology)

1. **4 parallel deep code audits** (one subagent each), covering the whole platform:
   - RLS + SQL + committed secrets across all 35 migrations.
   - All 11 Edge Functions + `_shared`.
   - The Immigration frontend (routes, guards, reader, admin, data).
   - Auth/session (`useAuth` ~1000 lines), query layer, guards, CI/CD.
2. **Empirical production probes** (read-only, service-role key, throwaway test accounts, all cleaned up):
   - Logged in as a `pflege` student → confirmed it can read all Immigration paid content.
   - Tested public signup, activation-code brute-force surface, the deployed edge-function version, the VDOCipher video↔lesson mapping, and OTP minting.
3. **Adversarial verification** of high-severity claims before acting.

Empirical evidence is in the Appendix.

---

## 2. Severity tally & status

> ⚠️ **A completeness sweep (§7) found the most severe issue AFTER the first round:** a **LIVE privilege-escalation** — any student can self-grant `is_admin`/`course_access` from the browser console (verified against prod). Fix = migration **037**, must be applied urgently. See §7.

| Sev | # | Fixed/authored | Pending action |
|---|---|---|---|
| 🔴 CRITICAL | 3 | 3 (code) | **apply mig 037 (URGENT)**, deploy fn (T1), apply mig 036 (T2) |
| 🟠 HIGH | 3 | 1 (CI) | RLS apply, signup |
| 🟡 MEDIUM | ~8 | 2 | cert-integrity, RPC leak, sourcemaps, CSV, bonus PDFs |
| 🟢 LOW | 8+ | 5 | legacy PHP, feedback, smoke-test |

The **privilege-escalation is the emergency** — it grants full admin (all PII, revenue, GDPR-purge) and defeats the course-isolation fix. It was verified exploitable on production.

---

## 3. Findings register

Each finding: **[ID] Severity — Title** · *status* · location · evidence · impact · fix.

### 🔴 CRITICAL

**[F1] Cross-course video theft (paid-content paywall bypass)** · *FIXED in code; needs deploy + migration apply*
- **Location:** `supabase/functions/vdocipher-otp/index.ts` (authz block) + RLS on `lessons`/`immigration_lessons`.
- **Evidence:** OTP function authorized a video if published in `lessons` **OR** `immigration_lessons`, then signed an OTP with that course's key — but read the caller's profile only for `revoked_at`, never `course_access`. RLS `"imm_lessons read" … USING (true)` (+ `"Authenticated users read lessons"`) made every `vdocipher_video_id` world-readable to any logged-in user. **Proven live:** a `pflege` test student read all 40 Immigration video IDs and minted... (blocked only because nothing was published yet + old build deployed).
- **Impact:** any student (either course) streams the *other* course's entire paid video catalog they never bought. Direct revenue bypass.
- **Fix (done):** (a) OTP entitlement gate — `profile.course_access` must equal the matched video's course, admins bypass, else `403 COURSE_FORBIDDEN` (`vdocipher-otp/index.ts`, added `course_access`+`is_admin` to the profile select). (b) Migration `20260723000036` scopes the video-ID table reads by course. **Still needs: hand-deploy of the function + apply the migration** (Tasks T1, T2).

**[F2] 61 paid lesson scripts served unauthenticated from the CDN** · *FIXED at origin; edge-cache purge pending (T8)*
- **Location:** `app/public/content/immigration/*.md` (61 files).
- **Evidence:** Vite copies `public/` verbatim to the CDN; `https://app.aurel-academy.com/content/immigration/<slug>.md` returned **200** with the full teleprompter script — ~170 KB / ~31,700 words of the paid course. **Nothing in the app reads these** (`fetchImmigrationLesson` was dead code; the reader intentionally does not render script bodies).
- **Impact:** the entire Immigration course text, free to anyone who opens devtools. Zero functional benefit.
- **Fix (done):** moved all 61 `.md` out of `public/` to `platform/content/immigration-scripts/` (kept as filming reference, off the public build). Also deleted the dead `fetchImmigrationLesson`.

### 🟠 HIGH

**[F3] Cross-course bonus PDF download** · *FIX authored in migration 036; needs apply*
- **Location:** `bonus_resources` RLS `"Authenticated users read bonus" … USING (true)` (`20260426000001`) + storage `"bonus-resources read for authenticated"` (`20260503000016`) — the latter checks bucket + `auth.uid()` + not-revoked, **no course check**.
- **Impact:** any authenticated (incl. free-signup) user can read `bonus_resources` rows and `createSignedUrl` on any object in the private bonus bucket → download paid PDFs outside their entitlement.
- **Fix:** migration 036 adds a `course` column to `bonus_resources` (default `'pflege'`), scopes its SELECT by `has_course(course) OR is_admin`, and scopes the storage read to `has_course('pflege') OR is_admin` (bucket is Pflege-only today). **Follow-up:** when Immigration bonuses move into the private bucket, switch the storage policy to a course-prefixed path check. (The 7 Immigration bonus PDFs currently sit in `app/public/content/immigration/bonus/` — still public; see T5.)

**[F4] Quiz answer-key leak (cross-course)** · *FIX authored in migration 036; needs apply*
- **Location:** `quiz_questions` `"Authenticated read quiz_questions" … USING (true)` (`20260524000028`) + `immigration_quiz_questions` `"imm_q read" … USING (true)` (`20260611000033`). Both expose `correct_index`.
- **Evidence:** **Proven live** — a `pflege` student read all **255** Immigration quiz questions *with* `correct_index` + explanations.
- **Impact:** any logged-in user dumps every answer key (own course + the other), trivializing the 3/5 unlock gate and reading a course they didn't buy.
- **Fix:** migration 036 scopes both SELECT policies to `has_course(...) OR is_admin`. **Secondary (open):** the scoring RPCs `submit_quiz_attempt` / `submit_immigration_quiz_attempt` echo `correct` back in their response — this is needed by the UI to show per-question feedback for the *just-submitted* attempt, so it is low-value to change and is **left as-is** (RLS now blocks bulk answer harvesting, which was the real leak).

**[F5] CI edge-function deploy silently never ships** · *FIXED in workflow; hand-deploy + secret check pending*
- **Location:** `.github/workflows/deploy-edge-functions.yml`.
- **Evidence:** prod ran the **old** `vdocipher-otp` build (returned `lesson_number`; new code returns `lesson`) despite two pushes. Root cause: the deploy loop ran under `set -e`, and `vdocipher-otp` sorts **last** alphabetically — any earlier function's bundle failure aborted the loop before reaching it. Compounded by **no `workflow_dispatch`** (so the RUNBOOK's `gh workflow run` recovery is impossible) and possibly-unset `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` GitHub secrets. Frontend deploys via Cloudflare Pages, masking the dead pipeline.
- **Fix (done):** rewrote the workflow — resilient loop (collect failures, continue, fail at end), added `workflow_dispatch`, fail-fast with a clear message on missing secrets. **Still needs:** confirm the two GitHub secrets are set (T7), and hand-deploy `vdocipher-otp` now (T1).

### 🟡 MEDIUM

**[F6] `activate-account` — no rate-limiting + enumeration oracles** · *PENDING (T4)*
- **Location:** `supabase/functions/activate-account/index.ts` (public, no throttle; oracles at code validation + `EMAIL_ALREADY_EXISTS`; internal error strings returned to caller).
- **Evidence:** distinct `CODE_INVALID` vs `CODE_ALREADY_USED`; legacy short codes exist. **Prod:** 81 codes, **66 unused/redeemable**, 11 in the shorter `XX-YYYY` (4-char suffix) format.
- **Impact:** an attacker can brute-force/enumerate valid codes and redeem (steal) paid access with a throwaway email; email-existence oracle.
- **Fix:** per-IP rate-limit + backoff (needs a small `activation_attempts` table or KV; **fail-open** on throttle-store errors so it never blocks legit students); generic error copy for invalid-vs-used; stop returning internal `*.message` to the caller (log server-side).

**[F7] OTP function's `service_role` client is overridden by the caller JWT** · *NOTED (footgun, non-breaking)*
- **Location:** `vdocipher-otp/index.ts` — `createClient(URL, SERVICE_ROLE_KEY, { global: { headers: { Authorization: <caller JWT> } } })`.
- **Evidence:** supabase-js keeps the caller `Authorization`; PostgREST derives the role from that JWT (`authenticated`), so all `.from(...)` reads run **as the user under RLS**, not as service_role. Works today only because those RLS policies were permissive.
- **Fix:** use an **anon-key** base for the JWT-scoped client, and a separate header-free **service_role** client for any read that must bypass RLS (pattern already used correctly in `admin-purge-user` / `smoke-test`).

**[F8] Revoked/kicked user keeps a client session ~30 min** · *BY DESIGN (accepted)*
- Client self-eviction is slow (10-min poll × 3 strikes) by deliberate "never logout" design. **All server enforcement is solid** (`is_admin()` false for revoked, RLS gates every table, OTP checks `revoked_at`, 1h JWT). No data/action leaks. Tighten poll cadence only if prompt eviction is required.

**[F10] Public signup enabled on prod despite `config.toml`** · *PENDING (T3)*
- **Evidence:** `config.toml` has `enable_signup = false`, but `POST /auth/v1/signup` on prod returns **200** and creates an (unconfirmed) user. Registration is meant to be code-only via `activate-account`.
- **Impact:** anyone can create a confirmable account → attack surface for the content leaks (mitigated by migration 036: a fresh signup has no `profiles` row, so `has_course()` returns false) and for brute-forcing.
- **Fix:** disable sign-up in Supabase **Auth settings** (dashboard), or `supabase config push`.

### 🟢 LOW (most fixed)

- **[F9] ImmigrationGuard bounced real Immigration students** on the JWT stub (which lacks `course_access`) on slow ISP / new device. Fail-closed (safe) but wrong. **FIXED** — mirror AdminGuard's 5s stub wait.
- **[F11a] Duplicate lesson id `8.4`** (two lessons) → display-only (`id` never used as a key; slugs are unique). **FIXED** → second becomes `8.5`. *(Also fix the generator `generate-immigration-data.py` / `immigration-course-structure.json` so a regen doesn't reintroduce it.)*
- **[F11b] VideoPlaceholder copy** told students to "read the content below" that isn't rendered. **FIXED.**
- **[F11c] Dead code** in `lib/immigration.ts` (fetch, localStorage progress block, markdown renderer). **FIXED (removed).**
- **[F11d] `sentry-test` / `telegram-test`** used non-timing-safe `!==` on the cron secret. **FIXED** → `timingSafeEqual`.
- **[F11e] `health`** returns `Access-Control-Allow-Origin: *` and leaks infra detail (bucket names, counts). **PENDING** — drop `*`, return `{status}` only publicly.
- **[F11f] `queries.ts` `withQueryTimeout`** has no `AbortController` (timed-out fetch runs to completion — resource waste only); several point queries lack the timeout wrapper. **OPTIONAL.**

### ✅ Verified clean (checked, not skipped)
No committed secrets anywhere (`.env.production` holds only public `VITE_*`/placeholder). No RLS recursion (historical mig-009 bug fixed in 010). Every `SECURITY DEFINER` function pins `search_path`. All admin checks go through `is_admin()` (revoked-guarded). `WITH CHECK` present on all user-write policies. Per-user Immigration tables (`immigration_notes/progress/quiz_attempts`) correctly `auth.uid()`-scoped. `admin-purge-user` + `send-email` hardened. `jwt.ts` decode-only, UX-only. PWA/stale-deploy handling sound. Dev-only `/preview-immigration` routes stripped in prod via `import.meta.env.DEV`.

---

## 4. Already fixed & pushed this session

| Commit | Contents |
|---|---|
| `f05cd50` | Immigration VDOCipher pipeline (player, admin lessons page, `immigration_lessons` table, reader wiring) + committed migrations 034/035 |
| `00a46ef` | Per-course VDOCipher key (Immigration is a separate account → two keys) |
| `339c272` | **R24 batch 1:** OTP entitlement gate, migration `036` (course-isolation RLS), remove 61 public scripts, 8.4→8.5, placeholder copy |
| `18821dd` | **R24 batch 2:** CI deploy resilience + `workflow_dispatch`, `config.toml` vdocipher-otp entry, ImmigrationGuard fix, dead-code removal, timing-safe compares |

Data already loaded: all **40** Immigration video IDs written to `immigration_lessons`, **`is_published = false`** (nothing student-visible until verified).

---

## 5. Remaining work — actionable tasks

> Ordered. T1/T2/T3 are the critical path; the rest are hardening.

**[T1] Deploy the fixed `vdocipher-otp` function.** *Blocks: F1 gate + Immigration playback.*
- The user runs `supabase login` (one-time, browser). Then: `supabase functions deploy vdocipher-otp --project-ref dvrqtqghgaxhhgkoihcj` from `platform/`.
- The secret `VDOCIPHER_API_KEY_IMMIGRATION` is already set in the Supabase edge secrets.
- **Verify:** publish lesson 1.3, sign in as an Immigration test account, call the function → expect `200 { otp, playbackInfo, lesson: "immigration-…" }`; a `pflege` account → `403 COURSE_FORBIDDEN`. Un-publish after.

**[T2] Apply migration `20260723000036_course_isolation_rls.sql`.** *Closes: F1 (DB half), F3, F4.*
- Paste into the SQL editor and run. It is idempotent; only additive schema change is `bonus_resources.course`.
- **Precondition:** the smoke-test account must have `course_access = 'pflege'` (else `select_lessons` reads 0).
- **Verify:** run the RUNBOOK smoke test; then re-run the cross-course probe (Appendix A) — a `pflege` student must now read **0** rows from `immigration_lessons` / `immigration_quiz_questions`, and Pflege reads must still work.

**[T3] Disable public signup.** *Closes: F10.*
- Supabase Dashboard → Authentication → turn off sign-ups. (Registration stays via `activate-account`.)

**[T4] Harden `activate-account`.** *Closes: F6.*
- Add a per-IP throttle (DB table `activation_attempts(ip, ts)` or KV; window e.g. 10/min, **fail-open** on store error). Merge `CODE_INVALID`/`CODE_ALREADY_USED` into one generic message. Remove `detail: err.message` from responses (log server-side). Redeploy via CI (now fixed) or `supabase functions deploy activate-account`.

**[T5] Protect the Immigration bonus PDFs.** *Closes: F3 remainder.*
- Move the 7 PDFs from `app/public/content/immigration/bonus/` into the private `bonus-resources` bucket under a `immigration/` path prefix; add `bonus_resources` rows with `course='immigration'`; change the frontend to fetch via `createSignedUrl`; switch the storage policy to a course-prefixed path check. (Feature-level change — do deliberately.)

**[T6] Confirm CI secrets & finish hardening.** *Supports: F5.*
- `gh secret list -R emirmesbah-cloud/PLATFORME-COURS` → ensure `SUPABASE_ACCESS_TOKEN` (valid PAT) + `SUPABASE_PROJECT_REF` are set. Optionally pin `supabase/setup-cli` to a fixed version. Then a push (or the new **Run workflow** button) should deploy all functions green.

**[T7] Minor:** tighten `health` (drop CORS `*`, minimal public body) [F11e]; add `AbortController` to `withQueryTimeout` [F11f]; fix the `8.5` id in the data generator source so a regen keeps it [F11a].

**[T8] Purge the Cloudflare edge cache for the removed scripts.** *Completes F2.*
- The scripts are gone from origin (verified: a cache-busted URL 404s), but Cloudflare's edge still serves `/content/immigration/*.md` from cache (`CF-Cache-Status: HIT`). Until purged, warmed edge nodes keep leaking.
- Cloudflare Dashboard → the `aurel-academy.com` zone → **Caching → Configuration → Purge Cache** → purge by URL prefix `https://app.aurel-academy.com/content/immigration/` (or "Purge Everything" — brief perf blip only).
- **Verify:** `curl -s -o /dev/null -w "%{http_code}" https://app.aurel-academy.com/content/immigration/0-1-pourquoi-l-allemagne-te-veut-les.md` returns **404** without a cache-buster.

---

## 6. Environment quick-reference (verified this session)

- **Prod Immigration state:** `immigration_lessons` = 40 rows (all `is_published=false`, correct video IDs). `immigration_quiz_questions` = 255 (51 lessons). Per-user tables empty. Activation codes: 81 total (all `course='pflege'`), 66 unused. Profiles: 19, all `course_access='pflege'`.
- **VDOCipher (Immigration account):** 40 videos, all `[ready]`. Video→lesson map derived by module.lesson number, with two content-based corrections (VDOCipher titles mislabel module 6 "6.3"×2 → 6.3/6.4, and "module 8-5" → the mis-ID'd "8.4/quoi-faire" lesson). 21 lessons still have no video.
- **Deployed edge fn before T1:** OLD build (pre-Immigration). Pflege OTP flow unaffected throughout.

---

## Appendix A — Reproduce the cross-course leak probe (read-only)

Using `platform/scripts/.env` (service role) + `platform/app/.env.local` (anon): create a throwaway `profiles` row with `course_access='pflege'`, sign in via `POST /auth/v1/token?grant_type=password`, then with that JWT (`apikey: <anon>`, `Authorization: Bearer <jwt>`) GET `immigration_lessons?select=lesson_slug,vdocipher_video_id` and `immigration_quiz_questions?select=correct_index`. **Before T2:** both return rows (leak). **After T2:** both return 0. Delete the test user + profile after. (Full scripts were used and cleaned up during the audit.)

---

---

## 7. Completeness-sweep additions (adversarially verified)

A second automated pass audited the areas the first round didn't cover (13 admin pages, the Pflege student flow, supply-chain/config/headers, the legacy static site) and re-verified the R24 fixes. It surfaced **9 new findings** — including the platform's most severe. Each below was confirmed by an independent adversarial verifier.

### 🔴 CRITICAL — LIVE privilege escalation (verified on prod)
**[F0a] Any student can self-set `profiles.is_admin = true`** · *FIXED via migration 037 — MUST APPLY URGENTLY.*
- **Location:** trigger `protect_profile_immutable_fields` (last def `20260520000019:17-48`) + `"Users update own profile"` RLS (`20260429000009:35-39`).
- **Evidence:** the immutability trigger guards tier/email/id/activated_at/revoked_* but **not `is_admin`** (that guard existed in mig 006, was dropped in mig 014, never restored). RLS is row-scoped only; no column REVOKE (and table-level UPDATE overrides column REVOKE). **Reproduced on prod:** `update({is_admin:true})` on own row → `200` → profile now `is_admin:true`.
- **Impact:** one browser-console line = full admin (read all PII, generate codes, view/forge accounting, revoke/GDPR-purge any user).
- **Fix:** migration `20260724000037` re-adds the guard (non-admin change → exception; service_role + admin paths unaffected). **Incident check:** 4 profiles are currently `is_admin=true` — `younessiyoucef@`, `amirmesbah510@`, `kardjadja.ahmed2206@`, `aminetbalia6@` (0 have non-pflege course_access). **Confirm each is an intended admin; investigate any you don't recognize.**

**[F0b] Any student can self-set `profiles.course_access`** · *FIXED via migration 037.* Same root cause; **reproduced on prod** (`course_access → 'immigration'`). This **defeats migration 036 + the OTP entitlement gate**, both of which trust `course_access`. Migration 037 blocks it. *(037 is therefore a prerequisite for 036/the OTP gate to actually hold.)*

### 🟡 MEDIUM
**[F12] Certificate forgery & quiz-gate bypass via direct table writes.** `lesson_progress` + `quiz_attempts` are user-writable (`FOR ALL/INSERT … auth.uid()=user_id`, no trigger recompute, no REVOKE), so a student can `upsert({completed:true, watched_seconds:0})` for every lesson → `check_and_issue_certificate` mints a real `AUREL-YYYY-NNNN` cert; and `insert({score:5,passed:true})` unlocks every quiz — bypassing the server-scoring RPCs. **Fix (mig):** `REVOKE INSERT,UPDATE ON lesson_progress, quiz_attempts FROM authenticated` (keep SELECT; the SECURITY DEFINER RPCs become the only write path), or BEFORE-triggers that recompute `completed`/`passed` server-side.

**[F13] Migration-036 fix-gap: `submit_immigration_quiz_attempt` leaks the answer key.** The SECURITY DEFINER RPC reads `immigration_quiz_questions` inside its body (bypassing 036's RLS), has no course check, is GRANTed to `authenticated`, takes an attacker-supplied slug, and returns the `correct_index` array; `get_my_immigration_status` hands out every quiz slug. **Fix (mig):** add `IF NOT is_admin(v_uid) AND NOT has_course('immigration') THEN return COURSE_FORBIDDEN` to the RPC (+ `has_course('pflege')` analog in `submit_quiz_attempt`); stop returning `correct`.

**[F14] Production sourcemaps publicly downloadable.** `sourcemap:'hidden'` still emits `.map` files; `@sentry/vite-plugin` is declared but **never wired into `vite.config.ts`**, so maps are never uploaded-then-deleted; `_headers` only sets `noindex`/`no-store` (the promised `_redirects` 404 rule was never added). Full TS source (RLS shapes, admin routes, edge-fn URLs) is retrievable by appending `.map` to any bundle URL. **Fix:** wire the Sentry plugin with `filesToDeleteAfterUpload`, or add a `_redirects`/Worker 404 for `/assets/*.map` + `/sw.js.map` + `/workbox-*.js.map`, or `sourcemap:false`.

**[F15] CSV formula injection in the Comptabilité export.** `AdminAccounting.tsx` `csvEscape` doesn't neutralize leading `= + - @` (student-supplied `first_name` etc.), so a crafted name executes as a formula when the admin opens the CSV in Excel. `AdminStudents.tsx` already has the fix. **Fix:** copy its `if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;` line.

**[F16] Immigration bonus PDFs served unauthenticated** (7 files in `app/public/content/immigration/bonus/`, linked from `ImmigrationOverview.tsx`). Same class as F2 (leftover after the scripts were moved). Low-sensitivity content (CV/cover-letter templates). **Fix:** move out of `public/`; deliver via the private bucket + signed URLs (folds into T5).

### 🟢 LOW
**[F17] Legacy PHP course platform (`public_html/cours`) is a stale, still-served surface.** `api/video.php` mints a VDOCipher OTP for any video with any *used* coupon (no coupon↔video binding), disables TLS verification, and loads the **live Pflege VDOCipher secret** from an unprotected `_secrets.php`. Cross-course escalation does **not** apply (separate VDOCipher accounts; Immigration unlaunched; legacy video IDs empty), so severity is LOW — but it's a live endpoint reusing a real key with TLS off. **Fix:** confirm `/cours/` is still served; if so, 403/delete the legacy tree, add `api/.htaccess`, and **rotate the Pflege VDOCipher secret**. *(cPanel host, not the git repo.)*

**[F18] Feedback publication-consent broken (regression).** Mig 014 forces `is_public=FALSE` on insert and dropped user UPDATE, so a student choosing "publish OK" gets their insert **rejected** (can't submit at all) and no testimonial can ever be published. **Fix:** always insert `is_public:false`; capture consent in a separate `publish_consent` column the admin reads at moderation.

**[F19] Smoke-test false-green post-036.** `select_lessons` only fails on `error`, not empty results — if the smoke account isn't `course_access='pflege'`, the check goes green while course isolation is actually blocking reads. **Fix:** assert a non-empty result.

**[INFO] Supply chain clean.** Runtime deps current (supabase-js 2.104, vite 5.4.21, react 18.3.1, sentry 10.51). Only notes: `@sentry/vite-plugin` is a dead devDep (ties to F14); `esbuild 0.21.5` has a dev-server-only advisory (no prod impact).

### New tasks
- **[T-CRIT] Apply migration `20260724000037` in the SQL editor NOW** + verify the 4 `is_admin` accounts are all intended (revoke any that aren't). This is the top priority; it also unblocks the integrity of 036/the OTP gate.
- **[T9]** Cert-integrity migration (REVOKE writes on `lesson_progress`/`quiz_attempts` or recompute triggers) [F12].
- **[T10]** RPC entitlement guards on `submit_immigration_quiz_attempt` / `submit_quiz_attempt` [F13].
- **[T11]** Kill the public sourcemaps [F14]. **[T12]** CSV injection one-liner in AdminAccounting [F15]. **[T13]** Retire `/cours/` + rotate the Pflege VDOCipher key [F17]. **[T14]** Feedback consent [F18]. **[T15]** Smoke-test non-empty assert [F19].

*Generated by the Sherlock R24 audit + completeness sweep (11 agents, adversarially verified).*
