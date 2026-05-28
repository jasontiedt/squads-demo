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

### 2026-05-22 — MVP-3 handlers shipped; new test surface available

- DeployUnit (#53), Scout (#56), Attack (#54), Capital init (#57), Win condition (#55) all live in `@eoe/rules`.
- New error codes added to `RuleErrorCode`: `tile_not_found`, `tile_already_revealed`.
- CI now runs unit tests on every PR via `.github/workflows/unit-tests.yml` (PR #64). Closes the e2e-only gap.
- Test fixtures convention reaffirmed: use real catalog ids from `@eoe/assets-meta` (no synthetic placeholders) — hotfix #63 proved this is a real footgun.
- **needs-confirmation surface to expand:** Scout `unitId` ownership/existence validation, Attack siege-flag semantics, Capital RFC fields (`tileId`/`siegeState`/per-player `units[]`), Reaction-window state tracking.

### 2026-05-23 — MVP-4 contributions

- **PR #77 (#73 integration arc suite):** five `playable-arc` arcs — units-eliminated, capital-zero, 4-player partial elimination, win-precedence comparison, and one mid-skip. Found the `Attack`-against-building `not_implemented` gap (filed #78) and left the capital-zero arc as `it.skip` with a `@needs-confirmation` note — coordinator-grade flag rather than a rules-bug stop.
- **PR #82 (#73 follow-up — E2E baseline):** Playwright two-browser handoff baseline. Players join via game code, take alternating turns, capital-zero arc completes through the real UI surface (board + HUD) after Lando's #80/#81 landed and Artoo's #79 unblocked the action path.
- Initial spawn on #72 returned silent-success; second pass completed clean. Same recovery pattern as previous sessions.
- Carry-forward: expand needs-confirmation around the MVP-5 capital-RFC migration (new shape will need fixtures updated).


## Learnings — 2025-11-21T18:30:00Z (Issue #89 — MVP-5 acceptance arc)

- **MVP-5 acceptance pattern:** Integration tests live in `apps/worker/test/integration-*.test.ts`. They compose existing unit-level contracts (PlayAction, PlayTactic, EndTurn cleanup, seat-scoped GET redaction) into cohesive end-to-end arcs through the real Worker HTTP surface via MemoryKV. Don't duplicate unit coverage — combine.
- **Prefer real catalog cards over synthetic state.** `eng-levy-the-fyrd` (action, draw 2) and `eng-shield-wall` (tactic, buff infantry +1 health EoT) are typed against the locked Effect DSL and exercise real dispatch paths. Patch KV to seed hand + resources, not to invent fake cards.
- **Dispatcher hardcodes `expires:'end-of-turn'`** in `applyBuffUnitStat` regardless of catalog `duration` field. `TemporaryBuff` schema only has the `'end-of-turn'` variant — no non-expiring buffs through PlayTactic. EndTurn cleanup strips buffs from ALL units (own AND enemy, pinned interpretation) and drops the `temporaryBuffs` field entirely when the array empties.
- **Class-filter dispatch reads `loadCivMeta(owner.civ)`** to resolve a unit's catalog class. To seed enemy infantry, use a real english unit cardId (`eng-watchman`) and set the joining player's civ to english so the dispatch resolves correctly.
- **Seat-scoped GET contract** (`/games/:code?seat=N`, Issue #88): invalid seat (non-1..4) → 400 `{code:'bad_request'}`; valid seat + bearer mismatch → 401 `{code:'unauthorized'}`; success → 200 `{state, version, seat}` with seat N's hand unredacted as `CardId[]`, others as `{count}`. Anonymous GET (no `?seat=`) still redacts all hands — the seat-scoped path is additive, not replacement.
- **Test 3 (Playwright e2e action-card smoke) dropped per fallback rule.** The english deck is 20 cards (16 unit + 4 non-unit); opening 5-card hand has ~28% chance of zero action cards. No admin seed endpoint exists for e2e. Click-path coverage already lives in `apps/web/src/__tests__/PlayCardUi.needs-confirmation.test.tsx`. Shipped MVP-5 as Test 1 + Test 2 only.
- **Worktree workflow verified:** Spawned in `c:/GitRepos/squads-demo-89` on `copilot/89-integration-arc`. Pre-existing node_modules junctions worked; vitest ran clean. Stayed in the worktree — never touched the main checkout.

### 2025-11-21 — MVP-5 integration arc shipped

PR #96 shipped — two Miniflare integration tests covering the MVP-5 acceptance arc:
- `integration-mvp5-action-arc.test.ts` — seed → first turn → PlayAction (draw 2) → assert hand-size delta + moveLog entry.
- `integration-mvp5-tactic-buff.test.ts` — PlayTactic (buff own unit) → EndTurn → assert `temporaryBuffs` cleared.

Both green at merge.

**Deferred — Playwright two-browser E2E.** The seeded deck shuffles non-deterministically per game (no admin seed endpoint), making it impossible to reliably script "play the Action card that draws 2" from the e2e harness. The current `playable-arc.spec.ts` pattern doesn't apply — that arc was unit-driven, where game state is deterministic from the start.

**Carry-forward — file MVP-6 issue:** add an admin seed endpoint (e.g. `POST /admin/games/:id/seed-deck`) that pins deck order for test runs. Then the two-browser E2E for MVP-5's stop condition becomes scriptable. Worth filing before MVP-6 scope locks so it gets sized in.

## Learnings — 2026-05-27 (Issue #103 part B — MVP-6 reaction-arc e2e)

**Status:** PR opened **with failing test** — blocked on missing board-DOM testid for deployed unit. See `.squad/decisions/inbox/cassian-mvp6-e2e-blocker.md`.

**What works end-to-end in the spec (verified live in worker logs):**
1. Two-context Playwright setup with `tab-create` / `tab-join` flows and `selectOption('english')` / `selectOption('byzantines')` (NOT `{label: regex}` — `selectOption` rejects regex labels).
2. URL hash regex `#/g/([A-Z2-9]{6})` for extracting the game code.
3. `POST /admin/games/:code/seed` with `X-Admin-Secret: test-admin-secret` header and `{hostDeck, guestDeck}` body returns 200 → both clients pick up the seeded version via the 2s Lobby poll.
4. `playwright.config.ts` webServer command needs `--var ADMIN_SECRET:test-admin-secret` to make the admin path callable from tests.

**Critical DOM pin (cost me one iteration):**
- The `target-legal-*` rect has `pointer-events:none` and the underlying `cell-{x}-{y}` rect is what receives clicks. Use `[data-target-legal="true"]` to click the legal cell. **Do not** click `[data-testid^="target-legal-"]`.

**Fixture decision (filed for review):**
- Added `byz-imperial-shield` reaction card to `packages/assets-meta/data/byzantines.json` with `_needsConfirmation` metadata. Effect: `heal-capital amount:2 target:self` on `on-damage-dealt`. This is an **invented test fixture**, not a canonical card. Historians should flag/replace once a real Byzantine reaction card exists.

**Worktree gotcha (one more package):**
- `apps/e2e/node_modules` was NOT in the previously-junctioned set (rules/schema/assets-meta/worker/web). Required:
  ```
  cmd //c "mklink /J <worktree>/apps/e2e/node_modules <main>/apps/e2e/node_modules"
  ```
- **Squad action:** add `apps/e2e` to the auto-junction list at worktree-create.

**Unresolved blocker:**
- After Host clicks card + legal cell, no `[data-testid^="unit-"]` appears within 5s. Either deploy isn't applying or the deployed unit uses a different testid prefix. Sabine needs to confirm the board's deployed-unit DOM testid.
- Recommended follow-up: once unit-testid is confirmed, the spec should pass through attack + reaction-window without further changes.

**Tester-wearing-dev-hat reminder:** This is test-only code (e2e spec + 1 config tweak + 1 fixture card). No rules/worker/schema mutation.
