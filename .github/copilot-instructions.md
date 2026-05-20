# Copilot Coding Agent — Squad Instructions

You are working on **squads-demo** (project name: Echoes of Emperors), a virtual boardgame deployed on GitHub Pages with a Cloudflare Workers API. The repo uses **Squad**, an AI team framework. Follow these rules when picking up issues autonomously.

## Project Quick Facts

- **Stack:** TypeScript + Vite + React + Zustand (web) · Cloudflare Workers + KV (api) · Zod schemas shared both sides · pnpm workspaces · Vitest
- **Repo layout:** `apps/web`, `apps/worker`, `packages/schema`, `packages/rules`, `packages/assets-meta`
- **Deploy:** GH Pages (web, on push to `main`) + `wrangler deploy` (worker, manual)
- **Source of truth:** `.squad/decisions.md` and the locked architecture in `.squad/decisions/inbox/wedge-multiplayer-architecture.md`

## Before Starting Any Issue

1. Read `.squad/team.md` — roster, your capability profile, auto-assign policy.
2. Read `.squad/routing.md` — work routing rules.
3. Read `.squad/decisions.md` — team decisions you must respect.
4. If the issue has a `squad:{member}` label other than `squad:copilot`, that work belongs to a squad member; do not pick it up.
5. If the issue is `squad:copilot`, read your capability profile in `.squad/team.md` and self-check.

## Capability Self-Check

- 🟢 **Good fit** — proceed autonomously.
- 🟡 **Needs review** — proceed, and note in the PR description that a specific squad member should review before merge.
- 🔴 **Not suitable** — do NOT start work. Comment on the issue:
  ```
  🤖 This issue doesn't match my capability profile (reason: {why}). Suggesting reassignment to a squad member.
  ```

## Branch & PR Conventions

- **Branch:** `copilot/{issue-number}-{kebab-slug}` (your default) is fine; squad members use `squad/{n}-{slug}`.
- **PR body must include:** `Closes #{issue-number}`.
- **Draft PR while in flight**, mark ready when CI is green.
- **Commits:** small, conventional-commits style (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- **Never push to `main` directly.** Open a PR.

## Code Conventions

- TypeScript strict mode is on (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Honor it — no `any`, no `!` non-null assertions unless you've justified them in a comment.
- The rules engine in `packages/rules` MUST stay pure: no I/O, no `Math.random` (seeded RNG only), deterministic.
- Schemas live in `packages/schema` (Zod). Types are inferred from schemas — don't duplicate.
- The Worker re-validates every action server-side using `applyAction` from `@eoe/rules`. Do not bypass.
- Tests use Vitest. Worker tests use Miniflare.

## Decisions

If you make a decision that affects other team members, write it to:
```
.squad/decisions/inbox/copilot-{brief-slug}.md
```
The Scribe will merge it into `.squad/decisions.md`.

## Things You Should NOT Do

- Don't propose new architecture. That's Wedge's call.
- Don't redesign visuals or invent design tokens. That's Sabine's call.
- Don't change the Worker → KV contract without coordination. That's Artoo's domain.
- Don't pin interpretations of ambiguous rules in implementation. Write a Cassian-style test that pins the interpretation, label it `needs-confirmation`, and ask in the PR.
- Don't ship without tests when the change is in `packages/rules` or `apps/worker`.
