# Project Context

- **Owner:** Jason T
- **Project:** squads-demo — virtual boardgame on GitHub Pages, turn-based multiplayer, image-rich (maps/units/cards), rules driven by text docs
- **Stack:** TBD — test framework selection pending Wedge's stack decision
- **Created:** 2026-05-20

## Learnings

<!-- Append new learnings below. -->

## Learnings

### Issue #9 — needs-confirmation suite (PR #25, draft)

**What I shipped:** `packages/rules/src/__tests__/needs-confirmation.test.ts` (10 `describe` blocks, 14 `it.skip`, 2 live invariants) + `packages/rules/README.md` (pinned-ambiguities table + un-skip workflow). All 108 rules-package tests pass (94 + 14 skipped).

**The 10 pinned ambiguities and my default interpretations (all skipped pending Jason's confirmation):**

1. **Reaction timing windows** → One window per action, after gate-pass, before mutation.
2. **Two-effect cards (per-play vs per-game)** → Per-play choice. Card returned to hand can choose differently on re-play.
3. **King/Queen-attached unit discard** → NOT discardable for room. The "(excluding King/Queen)" clause applies to whichever unit is bearing the pawn at discard time.
4. **Camp resource regeneration** → Refresh to exactly 1 unexhausted token at start-of-turn. Camps are not banks; tokens don't accumulate.
5. **Scouting onto water** → Unit returns to origin and does NOT exhaust. Tile orientation still locked on reveal.
6. **Upgrade stacking** → Same upgrade card on two DIFFERENT units OK (no-double rule scopes to one unit). Also re-attach after destroy/discard OK.
7. **"Surrounding Capital" diagonals** → INCLUDES diagonals. Chebyshev 1 (8 adjacent squares).
8. **Melee mutual-kill square** → Square ends EMPTY. Attacker doesn't advance because attacker is destroyed in the same atomic step.
9. **Long-Range vs Short-Range diagonal ban** → Long-Range BYPASSES the ban at any range. The ban is keyword-scoped, not range-scoped.
10. **Deck-empty discard interactions** → Silent no-op for draw / mill / end-of-turn refill. No HP penalty. Parent action still resolves.

**Un-skip workflow lives in `packages/rules/README.md`:** ask Jason → write `.squad/decisions/inbox/cassian-ambiguity-N-<slug>.md` → un-skip → update README table → dedicated PR. Never bundle a confirmation with feature work.

**Suite design pins to remember:**
- `NEEDS_CONFIRMATION_COUNT` constant + a live test asserts it === 10. Bump the constant when adding/removing ambiguities. This is the load-bearing drift guard.
- `// @needs-confirmation:` is the grep tag. CI can count occurrences vs the constant.
- Tests reuse `baseState`/`withState` from `fixtures.ts` — no new fixtures. Stay aligned with the canonical state shape.
- `stub<T>(type)` helper casts `{ type }` to `Action` for tests that only need to hit the phase gate. When handlers exist, real payloads replace stubs as part of un-skipping.

**Implementation gating today (all 10 are "pinned but cold"):**
- #1, #8, #9 blocked on Attack handler.
- #2, #3 blocked on PlayAction / DeployUnit handlers.
- #4, #7 blocked on BuildCamp / BuildBarracks handlers.
- #5 blocked on Scout handler.
- #6 blocked on PlayUpgrade handler.
- #10 blocked on draw/mill (EndTurn exists but doesn't draw yet).

So un-skipping needs BOTH confirmation AND handler work. Recommend batching Jason's 10 answers in a single ceremony rather than one PR per question.

**Worktree gotcha:** worktree's `packages/{rules,schema}/node_modules` did NOT inherit from the main checkout's pnpm install. Had to junction them manually:
```
cmd //c "mklink /J <worktree>/packages/rules/node_modules <main>/packages/rules/node_modules"
cmd //c "mklink /J <worktree>/packages/schema/node_modules <main>/packages/schema/node_modules"
```
Without these, vite can't resolve `@eoe/schema` from the worktree. Worth telling Squad to do this at worktree-create time for any package that imports a workspace sibling.

**No production code touched. No schema touched. No worker touched.** Test-only PR as required by Wedge's lock.

### Issue #7 — deck/draw + end-of-turn hand-cap (PR #27, draft)

**What I shipped:** `packages/rules/src/draw.ts` (real `drawCard` + `drawAndDiscardCleanup` replacing Artoo's stub from #6), `packages/rules/src/rng.ts` (`mulberry32` + `seedFor` seeded PRNG primitive), `packages/rules/src/__tests__/draw.test.ts` (14 tests). All 106 rules tests pass, no regressions in schema (204) or worker (4).

**Key design choices:**

1. **No-reshuffle confirmed.** `drawCard` returns `{ state, drawn: null }` (SAME state ref, no clone) when `deck.length === 0`. `drawAndDiscardCleanup` breaks the draw loop early on null. Verified by the byte-equal JSON clone determinism test on EndTurn.

2. **Positional draws and discards — #7 itself uses zero randomness.** Draw pops `deck[0]`. Overflow discards take `hand.slice(7)`. The PRNG primitive ships now for #8+ but is not invoked in #7's logic. This keeps determinism trivially provable.

3. **Seeded PRNG contract (in `rng.ts`):** `mulberry32` is the canonical 32-bit uniform PRNG. `seedFor(state, salt)` mixes `state.seed | state.turn | state.activePlayer | salt` via FNV-1a 32-bit. Callers MUST pass a unique salt string (e.g. `'card:eng-action-rally'`). Re-using a salt across distinct effects is a determinism bug. Decision drop file written for the team.

4. **Hand-cap overflow discard: positional, end-of-hand, flagged `@needs-confirmation`.** When hand>7 after draws, the trailing slice discards. Rulebook silent on this. Recommend pinning in #9 suite or replacing with player-choice if rules support emerges.

**Worktree gotcha (again, confirming the #9 finding):** per-package `node_modules` did not inherit from main pnpm install. Junctioned `packages/rules/node_modules`, `packages/schema/node_modules`, `packages/assets-meta/node_modules`, and `apps/worker/node_modules` from main checkout. After that, vitest resolves `@eoe/schema` from worktree. Squad should bake this junction step into worktree-create.

**Tester wearing dev hat:** This was production code, not tests. Marked draft PR and added comprehensive determinism + edge-case tests. Recommend Cassian (me) NOT review — should go to a non-author per reviewer lockout rule.
