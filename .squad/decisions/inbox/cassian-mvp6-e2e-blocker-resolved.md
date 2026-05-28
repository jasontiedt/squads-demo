# Cassian — MVP-6 reaction-arc e2e blocker (issue #103 part B) — RESOLVED DIAGNOSIS

Status: **spec shipped as scaffolding via `test.skip`**
Date: 2026-05-28

## Corrected diagnosis (supersedes prior cassian-mvp6-e2e-blocker.md)

The prior blocker doc suggested the issue was either testid mismatch or the
deploy action not applying. Both wrong. Confirmed via code walk:

- `Board.tsx` lines 410-450: deployed units DO render as
  `<g data-testid="unit-${u.id}" ...>` — selector `[data-testid^="unit-"]`
  is correct.
- The deploy never lands because `player.resources` starts as `[]`
  (`packages/rules/src/initialState.ts:145`), and the only in-game source
  of resources is `BuildCamp`, which currently returns `not_implemented`
  in `packages/rules/src/applyAction.ts:304`.
- Therefore NO unit can be deployed via the e2e UI today, regardless of
  card cost (the cost-swap hypothesis from the prior doc is moot).

## Unblock path (out of scope for #103)

EITHER:
  (a) Implement `BuildCamp` effect handler in the rules engine, OR
  (b) Extend `admin-seed` to optionally seed `resources` + pre-deployed
      `units` on either player record.

(b) is cheaper and test-only. Recommend filing as a follow-up issue.

## What is shipped in #111

- `apps/e2e/tests/mvp6-reaction-arc.spec.ts` — full executable scaffolding
  for the reaction arc, marked `test.skip(...)` with a `@needs-confirmation`
  comment block pointing to this decision. ~365 lines covering create/join,
  admin-seed, phase advance, deploy click, attack target, reaction modal
  assertion, capital HP delta. Un-skip when (a) or (b) lands.
- `packages/assets-meta/data/byzantines.json` — `byz-imperial-shield`
  fixture reaction card (cost wild:1, on-damage-dealt → heal-capital self 2).
  Marked `_needsConfirmation` as an E2E fixture.
- `apps/e2e/playwright.config.ts` — wrangler dev now passes
  `--var ADMIN_SECRET:test-admin-secret` so the admin-seed endpoint is
  reachable from tests.

## Verified facts pinned for the next agent

- Admin seed endpoint: `POST /admin/games/:code/seed`, header
  `X-Admin-Secret: <secret>`. Body fields are
  `{ deckOrder, opponentDeckOrder, hand, opponentHand }` — **NOT**
  `{ hostDeck, guestDeck }` as the prior doc claimed. Returns
  `{ ok: true, version }` at 200. Verified.
- `target-legal-*` overlay rect has `pointer-events: none` — click the
  underlying `[data-target-legal="true"]` cell instead. Verified.
- `apps/e2e/node_modules` must be junctioned during worktree setup; the
  default 6-path junction list misses it. Recommend adding to the
  worktree-setup helper.
