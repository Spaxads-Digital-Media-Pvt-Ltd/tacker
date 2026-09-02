# Contributing

This repo is worked on by several people **and** by AI coding agents
(Claude Code, Cursor, …) running in parallel sessions. Two agents pushing
straight to `main` on the same day has already broken `main` once
(committed conflict markers) and silently reverted settled decisions
(font choice, filter scope) when the later push landed. The rules below
exist to stop that.

## `main` is protected — no direct pushes

Treat `main` as read-only. Every change lands via a **Pull Request** that
someone reviews and merges on GitHub. Do not `git push origin main`.

> **Repo admins:** turn this on for real in
> *Settings → Branches → Branch protection rules* for `main`
> — require a PR before merging, require at least one review, and
> forbid force-pushes. Until that's enabled, this is honour-system.

## Work on a branch

```bash
git checkout main
git pull origin main
git checkout -b <name>/<short-description>      # e.g. vivek/offers-everflow-parity
```

- Branch names: `<name>/<short-description>` — `name` is the person who
  owns the work (even if an agent is doing the typing), `short-description`
  is kebab-case and specific.
- Commit and push to **that branch only**:
  ```bash
  git push -u origin <name>/<short-description>
  ```
- Open a PR against `main` when the work is ready for review.

## Stay close to `main`

Long-lived branches that drift are how the painful conflicts happen.

- Pull `main` into your branch **often** — at least daily while active:
  ```bash
  git pull origin main            # from your feature branch
  ```
- Keep PRs **small** and merge them **often**. Prefer several focused PRs
  over one branch that lives for two weeks.
- If you're touching a hot shared file (`frontend/src/index.css`,
  `frontend/src/components/AppShell.tsx`,
  `frontend/src/components/SidebarUtilityMenu.tsx`, …), say so in the PR
  description and merge quickly, so a parallel session isn't editing the
  same lines for long.

## If you're an AI agent picking this repo up fresh

1. **Check your branch before you commit anything:**
   ```bash
   git branch --show-current
   ```
2. If it says `main`, **stop** — do not commit. Create or switch to a
   `<name>/<short-description>` branch first.
3. If it's unclear which branch the current work belongs on, **ask the
   person** — don't assume, and don't start a new branch without
   confirming the name.
4. Never merge to `main` yourself. Push your branch and hand back the PR
   link.
5. Don't discard uncommitted work you find — commit it to the correct
   branch (ask if the intent is unclear).

## Quick reference

| Situation | Do |
|---|---|
| Starting new work | `git checkout main && git pull` → `git checkout -b <name>/<desc>` |
| Ready to share | `git push -u origin <name>/<desc>` → open PR on GitHub |
| Branch fell behind | `git pull origin main` (from your branch), resolve, keep going |
| Work is merged | delete the branch, start a fresh one for the next task |
