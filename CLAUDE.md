# CLAUDE.md

## Project Overview

**Tracker** — Multi-tenant affiliate tracking SaaS (click tracking, conversion attribution, append-only money ledger, reporting, AI ops). Comparable to Trackier/Everflow. Two-repo system: `api-backend/` (all server-side) and `frontend/` (React SPA, UI only).

## Documentation

**Always read these first before implementing anything:**

1. `docs/claude/CLAUDE_MEMORY.md` — Compressed project context (start here)
2. `docs/claude/ARCHITECTURE.md` — Full architecture + data flows
3. `docs/claude/PROJECT_STRUCTURE.md` — Directory layout + purposes
4. `docs/claude/TECH_STACK.md` — Technology inventory
5. `docs/claude/BACKEND.md` — Backend structure + services
6. `docs/claude/FRONTEND.md` — Frontend structure + patterns
7. `docs/claude/DATABASE.md` — Schema + migrations
8. `docs/claude/API_REFERENCE.md` — API endpoints
9. `docs/claude/AUTH_AND_SECURITY.md` — Auth flows + security
10. `docs/claude/INTEGRATIONS.md` — External integrations
11. `docs/claude/ENVIRONMENT.md` — Environment variables (names only)
12. `docs/claude/WORKFLOWS.md` — End-to-end workflows
13. `docs/claude/IMPORTANT_FILES.md` — Quick reference for critical files
14. `docs/claude/KNOWN_ISSUES.md` — Known bugs + technical debt
15. `docs/claude/DEVELOPMENT_GUIDE.md` — Setup + commands

Only read the detailed doc that matches the area you're working on. Do not scan all docs on every turn.

## Context Loading Strategy

```
1. Read this file (CLAUDE.md)
2. Read docs/claude/CLAUDE_MEMORY.md
3. Read only the relevant detailed doc (e.g., BACKEND.md if working on backend)
4. Inspect only the source files relevant to the requested task
5. Implement the smallest correct change
6. Verify the change
7. Update documentation only if architecture/behavior changed
```

## Development Rules

- **Do not modify unrelated files.** Changes should be minimal and focused.
- **Do not rewrite working architecture unnecessarily.** Follow existing patterns.
- **Check existing implementations** before creating new ones. Reuse existing components/services/utilities.
- **Do not duplicate functionality.** One source of truth.
- **Do not expose secrets.** Never copy `.env` values. Never add secrets to frontend.
- **Do not modify `.env` secrets** unless explicitly asked.
- **Before changing architecture**, explain why and get confirmation.
- **Do not install dependencies** unless necessary and approved.
- **Verify changes** after implementation (typecheck, lint, build where available).
- **Money values are text** — never float/number for monetary amounts.
- **Every query filters by network_id** — never write cross-tenant queries.
- **Hot path (/click) must never touch Postgres synchronously.**
- **Frontend routes are lazy-loaded** — new pages need `React.lazy()` + `<Suspense>`.

## Git Rules

- **Never push to `main` directly.** Work on `<name>/<short-description>` branch.
- Check current branch before committing: `git branch --show-current`
- If on `main`, switch to a feature branch first.

## Brand Name

"Tracker" is a working name — renameable. The brand string lives in:
- `frontend/src/config/branding.ts`
- `api-backend/src/config/branding.ts`

Change both when renaming.

## Frontend Constraints

- No external state management library (no Redux, no Zustand)
- No Supabase client in frontend (browser never talks to Supabase directly)
- API client in `frontend/src/lib/api.ts` — Bearer token + envelope + auto-refresh
- Session in localStorage (`tracker.session.v2`), refresh in httpOnly cookie
- Design tokens in `frontend/src/index.css` (RGB triplets for alpha support)
- Fonts: Sora (UI) + Space Mono (IDs/tokens)
- Palette: Slate neutrals + teal accent

## Backend Constraints

- ESM modules throughout (`"type": "module"`)
- Raw pg queries — no ORM on hot path
- zod validation on all request bodies
- Envelope responses: `{ ok: true, data: T }` / `{ ok: false, error: { code, message } }`
- 5 segregated surfaces (Express/Fastify) on separate ports
- Tracking surface uses Fastify (latency budget), others use Express
- BullMQ workers for async processing (clicks, postbacks, fraud, retention, CAPI, feed sync)
