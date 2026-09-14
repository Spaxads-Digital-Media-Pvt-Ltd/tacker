# SECURITY-CRITICAL-01 — SEC-1 Production Secrets Exposure

**Date:** 2026-09-13
**Branch:** vivek/url-security-rate-limiter
**Finding:** SEC-1 (CRITICAL) from `docs/FINAL_SECURITY_GAP_ANALYSIS.md`
**Severity:** CRITICAL — production credentials present in local `.env` with risk of accidental commit
**Scope:** `api-backend/.env` and the repository's `.gitignore` configuration

---

## 1. Summary

A `.env` file containing live production credentials exists at `api-backend/.env`. The values have not been printed in this report (all instances use `[REDACTED]`).

A repository-level `.gitignore` already exists at `C:\Users\vivek\tacker\.gitignore` and explicitly excludes `.env` and `.env.*`. **No `git rm --cached` was required — `.env` is not in the git index on any branch and was never committed in any branch's history.**

The SEC-1 finding from the audit (production secrets in a tracked/committed `.env`) **does not match the current state of the repository**: there is no committed history of `.env`, no tracked file, and no remote exposure path. What remains is a **lateral risk**: the file exists on a developer machine, which is the expected pattern, but several rotation hardening steps remain.

---

## 2. Evidence

### 2.1 `.env` file inventory

```
api-backend/.env — 2099 bytes, modified 2026-09-13 19:02 (live production values present)
api-backend/.env.example — 2277 bytes, modified 2026-09-09 12:20 (placeholders only)
```

`api-backend/.env` exists and contains values for at least these secret categories (no values printed):
- `DATABASE_URL` — production Supabase Postgres pooler connection string
- `SUPABASE_SERVICE_ROLE_KEY` — service-role JWT (Supabase, [REDACTED])
- `SUPABASE_JWT_SECRET` — legacy HS256 verification secret (Supabase, [REDACTED])
- `PLATFORM_ADMIN_JWT_SECRET` — HS256 secret for the platform-admin surface (Supabase, [REDACTED])
- `NGROK_AUTHTOKEN` — ngrok tunnel auth token (Supabase, [REDACTED])

### 2.2 `.env.example` audit

`api-backend/.env.example` is safe to commit. All secret values are placeholders:
- `DATABASE_URL=postgres://tracker:tracker_local_dev@localhost:5432/tracker` (local Compose)
- `SUPABASE_SERVICE_ROLE_KEY=__set_me__`
- `SUPABASE_JWT_SECRET=__set_me__`
- `PLATFORM_ADMIN_JWT_SECRET=__set_me__`
- `NGROK_AUTHTOKEN` not mentioned (correctly omitted)
- `CLICKHOUSE_PASSWORD=` (empty)

### 2.3 Git tracking status

```
git ls-files .env → empty (NOT tracked)
git log --all --diff-filter=A -- .env → empty (NEVER added on any branch)
git log --all --diff-filter=D -- .env → empty (NEVER deleted from any branch)
git check-ignore -v .env → .gitignore:14:	.env	.env
```

**Conclusion:** `.env` was never committed to this repository. There is no committed history of these values in the local clone. There is no path by which these credentials could have been pushed to a remote via git from this clone.

### 2.4 `.gitignore` audit

The repository root `.gitignore` (at `C:\Users\vivek\tacker\.gitignore`) contains:
```
# --- Env / secrets (NEVER commit) ---
.env
.env.*
!.env.example
```

This is correctly configured: it excludes `.env` and any dotenv variants, with an explicit allow-list exception for `.env.example`. This rule has been in place for some time and was effective — the audit's "no `.gitignore`" finding was incorrect; the file exists at the repo root, not under `api-backend/`.

---

## 3. Source-tree secret scan

A `Grep` over `*.ts`, `*.js`, `*.json`, and `.env*` files searched for the five secret-name patterns: `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `PLATFORM_ADMIN_JWT_SECRET`, `NGROK_AUTHTOKEN`.

### 3.1 Files matching by category

| Category | Files | Risk |
|---|---|---|
| Test fixtures with `test-...-do-not-use-in-prod` strings | `vitest.config.ts`, `test/isolation/platform-admin-*.test.ts`, `test/helpers/tokens.ts`, `test/isolation/dashboard-kind-validation.test.ts` | None — all test placeholders |
| Source readers (`env.*` or `process.env.X`) | `src/config/env.ts`, `src/lib/db/pool.ts`, `src/lib/supabase.ts`, `src/lib/auth/verify-jwt.ts`, `src/lib/auth/platform-admin-token.ts`, `scripts/ngrok-tunnel.ts` | None — read from env, no hardcoded value |
| Scripts with documented env-var requirements | `scripts/gen-traffic.ts`, `scripts/seed.ts`, `scripts/seed-rich.ts`, `scripts/seed-rich-modules.ts`, `scripts/seed-demo-data.ts`, `scripts/bootstrap-platform-admin.ts` | None — reference env names only, all contain a "Refusing to run: DATABASE_URL points at a hosted Supabase project" guard |
| `.env.example` (safe to commit) | `api-backend/.env.example` | None — placeholders only |
| `.env` (live secrets — NOT committed) | `api-backend/.env` | Excluded by `.gitignore`, not in git index |

### 3.2 Test-config files

`vitest.config.ts` and several `test/isolation/platform-admin-*.test.ts` files contain fallback strings like `process.env.PLATFORM_ADMIN_JWT_SECRET ?? 'plat-test-secret-do-not-use-in-prod'`. These are test-only defaults — they are not real secrets and the suffix `do-not-use-in-prod` is intentional. No remediation required.

### 3.3 Scripts with production-database guards

All seed and traffic scripts (under `scripts/`) include a guard rejecting hosted Supabase connection strings, requiring `localhost` or `127.0.0.1`. This is correct defense-in-depth — it prevents accidental writes to production.

### 3.4 Source reads from env

`src/config/env.ts` uses `z.string().url()` and `z.string().min(1)` to validate secrets at startup. `src/lib/db/pool.ts`, `src/lib/supabase.ts`, `src/lib/auth/verify-jwt.ts`, `src/lib/auth/platform-admin-token.ts`, `scripts/ngrok-tunnel.ts` all read from `process.env` only. No hardcoded production values found in any committed source file.

**No secret values are present in any file currently tracked by git.**

---

## 4. Containment status

| Action | Status | Notes |
|---|---|---|
| `.gitignore` excludes `.env` and `.env.*` | **DONE** | Already in place at repo root line 14 |
| `.env` removed from git index | **N/A** | Never tracked |
| `.env` removed from all branch histories | **N/A** | Never committed |
| `.env.example` is safe to commit | **DONE** | Placeholders only |
| No real secret values in source | **DONE** | Verified by Grep across all `.ts/.js/.json/.env*` |
| No real secret values in `.env.example` | **DONE** | Verified |

No `git filter-repo`, `git filter-branch`, or `BFG` history rewrite was performed — none was needed because there is nothing to rewrite.

---

## 5. Rotation requirements

Even though no secrets were committed to git, the credentials in `api-backend/.env` are live production values. Their exposure surface is the **developer machine**: the file is readable by anyone with shell access to this machine, and by any process running on this machine (including the dev backend when started locally). Rotation guidance:

### 5.1 Credentials that MUST be rotated

These values grant direct production access. Rotation is recommended regardless of whether they were ever committed externally:

| Credential | Why rotate | Rotation source |
|---|---|---|
| `DATABASE_URL` (Supabase Postgres pooler password) | Grants read/write to all production tables | Supabase dashboard → Project → Settings → Database → Reset password |
| `SUPABASE_SERVICE_ROLE_KEY` | Grants admin-level auth (bypasses RLS) | Supabase dashboard → Project → Settings → API → `service_role` → Regenerate |
| `SUPABASE_JWT_SECRET` | Used to verify HS256 tenant JWTs (legacy path) | Supabase dashboard → Project → Settings → API → JWT Secret → Generate new |
| `PLATFORM_ADMIN_JWT_SECRET` | Signs platform-admin surface JWTs (HS256) | Operator-generated — rotate by setting new value and restarting platform-admin process |
| `NGROK_AUTHTOKEN` | Grants control over a paid ngrok account | ngrok dashboard → Auth → revoke + re-issue |

### 5.2 Rotation order

To avoid locking out concurrent operators or breaking running processes:
1. **Rotate `NGROK_AUTHTOKEN`** first — independent of the application, no consumer coupling beyond the dev tunnel script.
2. **Rotate `SUPABASE_JWT_SECRET`** second — affects only legacy HS256 token verification. Real production tokens are ES256 via JWKS (per `verify-jwt.ts` lines 22-26), so existing sessions are not invalidated.
3. **Rotate `PLATFORM_ADMIN_JWT_SECRET`** third — invalidates all existing platform-admin sessions; re-login required for all platform-admin operators.
4. **Rotate `DATABASE_URL` (postgres password)** fourth — coordinated with any other developer who has the same value; on rotation, the Supabase pooler endpoint URL stays the same.
5. **Rotate `SUPABASE_SERVICE_ROLE_KEY`** last — invalidates backend service-role auth; backend will fail health checks until restarted with new key.

### 5.3 Post-rotation

After rotating, update `api-backend/.env` on this machine and on every other machine that runs the backend. The `.env.example` template does not need updating — it remains placeholder-only.

---

## 6. Forward-going hardening

Even though no secrets are in git, the audit's broader concern (lateral exposure from a local `.env`) warrants:

1. **Confirm `.gitignore` enforcement on the remote.** Verify on the remote (GitHub/GitLab/etc.) that pre-commit hooks or push-protection rules block any future attempt to push a file matching `.env*`.
2. **Use of a secrets manager** for local dev. Options: `direnv` + encrypted `.envrc`, `1Password CLI`, `doppler`, or `Infisical`. A secrets manager reduces the chance that a screenshot or terminal paste captures a real value.
3. **Periodic credential scanning** in CI. Tools: `gitleaks`, `trufflehog`, or GitHub's built-in secret scanning. Should run on every PR.
4. **Document the rotation cadence.** Add a checklist to `docs/claude/ENVIRONMENT.md` (names only, no values) and a runbook to `docs/` describing how to rotate each credential.

---

## 7. Files referenced

| Path | Action | Reason |
|---|---|---|
| `C:\Users\vivek\tacker\.gitignore` | Read only — already correct | Excludes `.env` and `.env.*`, allows `.env.example` |
| `api-backend/.env` | **NOT modified** | Already excluded from git; modification is the operator's responsibility when rotating |
| `api-backend/.env.example` | Read only — already safe | Placeholders only |
| `docs/SECURITY_CRITICAL_SEC1_SECRETS.md` | Created (this file) | Audit deliverable |

No source files were modified. No code changes were made. No test runs were executed. No destructive git operations were performed.

---

## 8. Pre-Report Checklist

- [x] `.env` presence confirmed, no values printed
- [x] `.gitignore` verified at repo root (line 14: `.env` excluded)
- [x] `.env` not in git index (`git ls-files .env` empty)
- [x] `.env` never added to any branch (`git log --all --diff-filter=A` empty)
- [x] `.env` never deleted from any branch (irrelevant — never added)
- [x] No destructive git operations (`filter-repo`, `filter-branch`, `BFG`) — none needed
- [x] `.env.example` audited — placeholders only, safe to commit
- [x] Source-tree scan for hardcoded secrets completed — none found in tracked files
- [x] Rotation requirements listed for each credential category
- [x] Forward-going hardening steps documented
- [x] Report written to `docs/SECURITY_CRITICAL_SEC1_SECRETS.md`

---

## 9. Discrepancy with audit finding

The audit (SEC-1) stated: *"Production secrets in `.env` committed to git with no `.gitignore` protection."* The current repository state does **not** match this finding:

| Audit claim | Actual state |
|---|---|
| `.env` committed to git | FALSE — never tracked |
| No `.gitignore` | FALSE — `.gitignore` exists at repo root, line 14 |
| Live production credentials present in `.env` | TRUE — file exists on disk with live values |

The file exists on disk (with live production values) and that part of the audit is correct. The git-tracked / committed / no-gitignore portion is not. The lateral risk (machine compromise, terminal paste, screenshot leak) remains. The audit's recommended remediation (rotation, secrets manager, CI scanning) is still appropriate.
