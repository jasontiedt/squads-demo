# Project Context

- **Owner:** Jason T
- **Project:** squads-demo — virtual boardgame on GitHub Pages, turn-based multiplayer, image-rich (maps/units/cards), rules driven by text docs
- **Stack:** TypeScript + Vite + React + Zustand (web) · Cloudflare Workers + KV (api) · Zod schemas shared · pnpm workspaces · Vitest · Playwright
- **Created:** 2026-05-20

## Learnings

Older entries (Issues #1–#12 schema build-out, #39 CI) live in `history-archive.md`.
Active learnings below.

<!-- Append new learnings below. -->

### 2026-05-22: Issue #57 — Capital placement + board init extracted to @eoe/rules (PR #61)

- **Moved from worker → `packages/rules/`:** `constants.ts` (`CAPITAL_DEFAULT_HP = 20`, `STARTING_HAND_SIZE = 5`, `MIN_DECK_AFTER_DRAW = 7`), `shuffle.ts` (`shuffleWith<T>`), `initialState.ts` (`buildCreatorState`, `addJoiner`). Worker's `game-init.ts` is now a 14-line re-export shim — call sites unchanged.
- **Capital ids:** `bld-cap-p1` / `bld-cap-p2` (issue spec). HP = 20 (long-game default per rulebook §324). Anchor squares (0,0) and (5,5); MVP-4 will randomize.
- **Production HP changed 10 → 20.** Test fixtures kept at 10 — they're round-trip sample data, not init-output assertions. Touching them is cosmetic.
- **Issue-vs-schema reconciliation:** Issue text mentioned `tileId`/`siegeState` on `BuildingInstance` and per-player `units[]`. None exist in current schema (#4 landed `BuildingInstance` with `square: Coord` and game-wide `units[]`). Did NOT add them; the stop condition is satisfied by existing fields. Decision filed at `.squad/decisions/inbox/artoo-capital-init.md` (merged) noting schema RFC needed before siege card effects.
- **Worktree gotcha (compounding earlier notes):** pnpm-installed `apps/worker/node_modules/@eoe/<pkg>` were REAL directory copies (not symlinks) in worktrees, pointing at main repo content. New files in `packages/rules/src/` invisible to the worker until I `rmdir /S /Q` and re-`mklink /J` with **absolute paths** (relative paths resolve against cmd CWD, not link location).
- Tests: rules 121 → 136 (+15), worker 43 → 44 (+1).

### 2026-05-22: Issue #56 — Scout action handler (PR #62, silent-success)

- **Files:** `scout.ts`, +2 error codes (`tile_not_found`, `tile_already_revealed`), wired into `applyAction`, 11 tests.
- **Shape lesson:** Spawn prompt guessed `tileId: TileId` but `ScoutAction` is `{ type, unitId, target: Coord }`. Resolved containing tile by walking `state.map.tiles[*].squares[*].coord` — matches the rest of the engine (everything speaks Coords).
- **Decision pinned (overrode prompt):** Rules engine does NOT bump `state.version` — Worker owns version. Declined the prompt's "Return Ok with bumped version" instruction because it conflicts with locked Wedge architecture and with `playCard`/`deployUnit` precedent.
- **MVP-3 simplifications:** no adjacency rule, no card cost, no per-turn cap, `unitId` not validated (`@needs-confirmation`), no re-orientation step.
- **Defensive target check:** existing `phases.test.ts` table-driven test stubs Scout as `{ type: 'Scout' }` with no `target`. Added guard at the top returning `tile_not_found` if `target` missing/malformed — keeps phase-gate semantics intact.
- **Silent-success:** finished file writes but spawn returned empty. Coordinator filesystem-checked + ran tests + opened PR. Pattern continues to recur — always check `git status` and tests before re-spawning.
- **Cross-worktree terminal noise:** Multiple concurrent worktrees in the same shell can cross-contaminate output. Pipe vitest to `/tmp/<task>-test.log` via `nohup ... &` and tail the file for clean reads.

### 2026-05-22: Issue #53 — DeployUnit handler (PR #59)
- Mobilization-phase gated via `ACTION_PHASE_LEGALITY`. Pays resource cost via catalog lookup, places unit on `state.units` with `owner: Seat`, `exhausted: false`.
- 14 tests covering cost / phase / actor / placement.

### 2026-05-22: Hotfix — deployUnit tests → real card ids (PR #63)
- Test fixtures referenced removed `byz-unit-placeholder` ids → migrated to `eng-watchman` from `@eoe/assets-meta`.
- Reinforces the merged `artoo-test-fixtures-use-real-catalog.md` decision: test fixtures MUST use real catalog ids, not synthetic placeholders.

### 2026-05-22: CI gap closed — unit-tests.yml (PR #64)
- Added `.github/workflows/unit-tests.yml` running `pnpm -r test` on every PR. Closes the e2e-only CI gap that let PR #58 merge with red unit tests green-overall.
- Conventions match `e2e.yml`: pnpm/action-setup@v4 (no version pin), setup-node@v4 with node 20 + pnpm cache, 15-min timeout, concurrency-cancels.

### 2026-05-22: Issue #54 — Attack handler (PR #65)
- `Attack` action: target square → damage application → kill / capital damage / siege flag (where supported).
- **Reuses `UnitInstance.exhausted`** for "already acted" gating. No `actedThisTurn` schema mutation. Decision filed `.squad/decisions/inbox/artoo-attack-acted-tracking.md` (merged). One unit-state field, both Mobilization (`deployUnit` sets false) and Action phase (Attack sets true) use it consistently.

### 2026-05-22: Issue #55 — Win condition (PR #66, silent-success)
- `applyAction` post-mutation hook checks capital HP ≤ 0 OR no opponent units → sets `state.winner: Seat | null`.
- Second silent-success event of the session — coordinator finished commit/push/PR.

## Active Patterns (cross-issue)

- **Worktree workflow:** Each issue gets `c:/GitRepos/squads-demo-<N>/`, junctioned `node_modules` (root + each workspace package), branch `copilot/<N>-<slug>`. Coordinator stays in main; agents work in worktrees. `git worktree list` before creating to avoid duplicates.
- **Silent-success pattern:** ~7-10% of background spawns finish file writes but return no text. ALWAYS filesystem-check (`git status`, look for new files/branches) before treating as failure.
- **Decision-inbox vs in-repo flagging:** Architectural decisions go to `.squad/decisions/inbox/artoo-<slug>.md`. Per-file `@needs-confirmation` comments stay inline with the code they qualify.
- **Engine purity invariant:** No `fs/path/fetch/crypto/Math.random/Date.now` in `packages/rules/`. Seeded RNG only. Worker owns I/O and `state.version`.
- **`@needs-confirmation` carry-list** (open against future issues):
  - Capital `tileId`/`siegeState` schema fields (RFC before siege effects)
  - Per-player `units[]` model (currently game-wide)
  - Reaction-window state tracking
  - Stone resource (still in `ResourceKind`, not in rulebook)
  - Technology subtypes A|B|C|D (unnamed in rulebook)

## 2025-05-23 — Issue #68: Capital-HP win condition

- **Schema reality vs. issue text:** Issue #68 says "Capital `BuildingInstance.health <= 0`" but the schema has NO `health` field on `BuildingInstance`. HP for capitals lives on `Player.capitalHp` (`packages/schema/src/state.ts`). `BuildingInstance` only carries `damage`. Implemented the win check against `Player.capitalHp <= 0` and pinned a code comment explaining the mapping.
- **Attack still does NOT damage capitals.** Despite issue #68 claiming #65 shipped capital damage, `packages/rules/src/attack.ts:86` still returns `not_implemented` when targeting a building. The win condition is testable today only via synthetic state with `capitalHp: 0`. Once attack-on-capital is wired (separate ticket), this win path will fire naturally.
- **Win precedence via code ordering.** Two win paths (#55 units-eliminated, #68 capital-HP) coexist in the EndTurn handler. Precedence is enforced purely by ordering: units-eliminated check runs first and `return`s if it fires; capital-HP check is unreachable on that turn. No flag, no extra branching. Pinned in a test that constructs a state triggering both paths and asserts the units-path result.
- **4-player corner rule.** Game ends ONLY when EXACTLY ONE occupied seat has `capitalHp > 0`. A single dead capital in a 4-player game does NOT end the game — three seats still alive ⇒ continue. Cleaner formulation than "find dead seat → find opposing seat".

## 2026-05-23 — Issue #78: Attack against Capital damages capitalHp

- **Lifted the MVP-4 stub.** `packages/rules/src/attack.ts` previously returned `not_implemented` when `action.targetBuildingId` was set. Branched off into a new `attackBuilding()` helper that mirrors the unit-target attacker validation (ownership, exhaustion, mode-match, attack-value>0) but targets a `BuildingInstance(type='capital')` and writes the effect to `Player.capitalHp`.
- **HP lives on `Player.capitalHp`, not on the building.** Consistent with #68's win-check decision. `BuildingInstance` only carries `damage`; I deliberately did NOT update `building.damage` because (a) #68's EndTurn check reads `capitalHp` only and (b) keeping the source of truth single avoids drift.
- **No clamp at 0.** `capitalHp` is allowed to go negative. #68's check is `<= 0`, so negative values still register as dead. Avoids special-casing exact-hit kills.
- **Capital is NEVER removed from `state.buildings`.** Persists at any HP. UI keeps rendering the square; win declaration happens via `Player.capitalHp` on EndTurn.
- **Non-capital buildings stay `not_implemented`.** Camp and Barracks targets return `not_implemented` with a clear message — MVP-5 will lift them. Pinned with a test that injects a camp into state.buildings and asserts the rejection.
- **Cassian's playable-arc Arc 2 is now unskipped.** The full action-driven capital-zero arc (Deploy + Move + Attack capital + EndTurn) chains through `applyAction` with NO state shortcuts. Win routes through capital-zero by leaving seat 2 with one unit on the board (units-eliminated guard would have fired otherwise since `units.length > 2`).
- **Test counts:** attack.test.ts grew from 25 → 39 tests (+11 capital-target cases: 2 happy, 8 rejections, 1 invariant; existing "rejects building target — not_implemented" test removed since the path now works). playable-arc.test.ts: 4 passing + 1 skipped → 5 passing. Total rules suite: 251 → 262 passing, 21 skipped.
- **No new error codes.** Reused `target_not_found`, `target_friendly`, `out_of_range`, `attacker_exhausted`, `attack_mode_mismatch`, `attack_value_zero`, `card_not_in_catalog`, `not_implemented`. Kept `RuleErrorCode` taxonomy stable.

### 2026-05-23 — MVP-4 contributions (summary)

- **PR #75 (#70 Move handler):** action handler shipped, gated by phase / seat / Chebyshev range / exhaustion (reuses `UnitInstance.exhausted` per the locked decision).
- **PR #76 (#68 Capital-HP win condition):** wired into `applyAction.EndTurn` — direct-state tests passed before #79 closed the action-driven path.
- **PR #79 (#78 Attack-vs-Capital):** lifted the deliberate `not_implemented` stub Cassian found mid-flight during #77. Same gates as unit-vs-unit attack; unblocked the capital-zero arc.
- Rules engine now covers the full MVP-4 action surface. Next: pick up the MVP-5 capital-RFC migration (Wedge's PR #74 sketch).

