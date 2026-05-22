# Project Context

- **Owner:** Jason T
- **Project:** squads-demo — virtual boardgame on GitHub Pages, turn-based multiplayer, image-rich (maps/units/cards), rules driven by text docs
- **Stack:** TBD — game state shape and persistence layer pending architecture decisions
- **Created:** 2026-05-20

## Learnings

<!-- Append new learnings below. -->

### 2026-05-20: Issue #1 — Map schemas (Coord, Tile, Square, Terrain)

- Added Zod schemas to `packages/schema/src/index.ts` under a "Map" section between TurnPhase and Players: `Coord`, `TerrainType`, `Square`, `TileKind`, `TileOrientation`, `Tile`. Types inferred via `z.infer` — never duplicated.
- **Decisions pinned in code (matching Wedge's rulebook synthesis):**
  - `Coord`: `x`/`y` integers in `[0, 5]` (6×6 base map = 3×3 tiles × 2×2 squares).
  - `TerrainType` enum: `plain | mountain | water | river | village | farmland | forest | mine | gold-double` (9 values from rulebook).
  - `Square` uses field name `coord` (verbatim per Issue #1 spec), not `position`.
  - `TileOrientation`: `z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])` — strict literal degrees, rejects 45/360 and string `'90'`.
  - `Tile.squares` enforced to `.length(4)` (2×2 grid).
  - `TileKind`: `starting | highland | constantinople`.
- Tests in `packages/schema/src/__tests__/map.test.ts` — 18 tests, round-trip + invalid-input coverage per type. Vitest, ESM `.js` import suffix.
- Tile *data population* (the actual starting tile catalog from `documentation/StartingTiles.txt`) is out of scope for #1 — separate issue.
- **Workspace gotcha:** `pnpm` is not on PATH on this Windows box. Use `npx -y -p pnpm@9 pnpm ...`. After fresh clone you must `npx -y -p pnpm@9 pnpm install` once before `tsc` is available at `node_modules/.bin/`.
- **Repo dirty-state gotcha:** main has unrelated uncommitted files (.github/prompts, wedge history, untracked docs/scripts). NEVER `git add .` on this repo — stage exact paths only.
- Branch: `copilot/1-schema-coord-tile-square-terrain`. PR body must include `Closes #1`.

### 2025-11-21: Issue #2 — ResourceToken & TemporaryResource schemas
- **Files:** `packages/schema/src/resources.ts` (new), `packages/schema/src/index.ts` (added re-export), `packages/schema/src/__tests__/resources.test.ts` (new, 20 tests).
- **Schemas:** `ResourceTokenId` (branded), `TemporaryResourceId` (branded — added beyond AC for symmetry), `ResourceKind` enum, `ResourceToken`, `TemporaryResource` with `.refine()` enforcing `current ≤ max`.
- **Branded-id pattern:** First branded ID in the schema package — `z.string().min(1).brand<'X'>()`. Issue #1's `Tile.id` was unbranded `z.string().min(1)`. Future entity IDs (CardId, CampId, PlayerId-token) should follow the branded pattern.
- **`@needs-confirmation` flag:** Included `'stone'` in `ResourceKind` per issue #2 AC, but rulebook synthesis only enumerated `{food, wood, gold, wild}`. Inline comment + PR note flagged. Resolution depends on whether `mine` terrain produces stone tokens or feeds gold.
- **Optional-field pattern:** Under `exactOptionalPropertyTypes`, `sourceCampId?: z.string().min(1).optional()` enforces "absent OR non-empty" — a test pins this (`sourceCampId: ''` rejected).
- **Refine error messages** are reachable on `safeParse().error.issues[0].message` — used to assert the overflow message specifically.

### 2026-05-20: Issue #3 � Card kinds discriminated union

- **Files created:** packages/schema/src/civ.ts (leaf), packages/schema/src/cards.ts (the union), packages/schema/src/__tests__/cards.test.ts (60 tests).
- **Files modified:** packages/schema/src/index.ts (re-exports civ.ts + cards.ts; removed local Civ enum and bare CardId = z.string(); Deck/GameState/PlayCardAction now use the branded CardId imported from cards.ts), packages/schema/src/resources.ts (strengthened stone @needs-confirmation comment with rulebook line 47 citation, mine?gold correction, OUT OF SCOPE note).
- **Schemas:** CardId (branded), CardCost (record over ResourceKind, nonnegative ints), 8 per-kind objects (Unit/Technology/Tactic/Upgrade/Action/Reaction/Event/Civilization), Card discriminated union on kind, CARD_KINDS const tuple + CardKind type.
- **Decision pinned (separate doc): effect and trigger are z.unknown() for MVP-1.** See .squad/decisions/inbox/artoo-card-effect-typing.md. Trade-off: z.unknown() accepts undefined, so missing trigger is not rejected � flagged with a comment in the schema and covered by a positive accepts arbitrary trigger test instead of a rejection test.
- **Reaction is a schema-only stub** for MVP-1 � header comment makes that explicit. Rules engine does NOT resolve reactions yet.
- **Stone status (still flagged):** Confirmed with rulebook line 47 (5 Food, 5 Wood, 5 Gold, 3 Wild) that stone is NOT in the rulebook. Per user direction, kept stone in ResourceKind for issue #3 (out of scope to remove) but strengthened the comment so future readers know not to add code paths that depend on it. Mine terrain produces gold, not stone (rulebook page 4 diagram).
- **Technology subtypes** A|B|C|D per issue spec � rulebook line 279 says There are 4 different technology types but doesn't name them. @needs-confirmation comment flags this for replacement once a civ booklet enumerates them.
- **New pattern: leaf-file for circular-import breaking.** cards.ts originally imported Civ from ./index.js, but index.ts re-exports ./cards.js. ESM cycle would TDZ Civ because z.optional() evaluates eagerly at module load. Fix: extract Civ to leaf civ.ts with no internal imports; both index.ts and cards.ts import from it. Use this pattern any time a barrel re-exports a submodule that needs an enum declared in the barrel.
- **Test count:** 60 in cards.test.ts (CardId 3, CardCost 5, per-kind ~3-4 each � 8, common-fields parametrized � 8 � 3, union/exhaustiveness 4). Total schema package: 98 passing.
- Branch: copilot/3-schema-card-kinds. PR body must include Closes #3 plus stone-status section + Technology-subtypes @needs-confirmation flag.

### 2026-05-20: Issue #4 — GameState, Player, UnitInstance, BuildingInstance

- **Files added:** `packages/schema/src/state.ts` (the model), `packages/schema/src/__tests__/state.test.ts` (50 tests), `apps/worker/test/fixtures/initial-state.ts` (English-vs-Byzantines fixture), `apps/worker/test/initial-state.test.ts` (3 tests parsing the fixture).
- **Files modified:** `packages/schema/src/index.ts` rewritten — removed obsolete old `Player`/`GameState`/`Deck`/`GamePhase`/old `TurnPhase` (draw/main/combat/end). Kept `GameId`/`PlayerId`/`PlayerToken`/`Seat`/Map types and the placeholder `Action` union (rules tests + worker stub still depend on these — full action union lands in #5). Added `export *` of `./state.js`. Also added `apps/worker/tsconfig.json` `include: ["src/**/*", "test/**/*"]` so the fixture+test typecheck under strict.
- **Decisions pinned (separate doc):** see `.squad/decisions/inbox/artoo-gamestate-shape.md`.
  - **BuildingInstance is a Zod discriminated union by `type`** with three variants (Camp/Barracks/Capital), each `.strict()`. Rationale: discriminator gives type narrowing at consumption sites AND `.strict()` makes "terrain only on Camp" a structural rule — a Barracks shape with `terrain: 'plain'` is rejected at parse time, not silently stripped. Alternative (single object + `.refine`) was rejected because it loses narrowing and produces worse error messages.
  - **`PlayersBySeat` is `z.object({1: Player.optional(), 2: Player.optional(), 3: Player.optional(), 4: Player.optional()})`, NOT `z.record(Seat, Player)`.** JSON object keys are always strings; `Seat = z.union([z.literal(1)..z.literal(4)])` rejects string keys with `invalid_literal` errors. Explicit object with optional fields is the strict-mode correct shape.
  - **`GameId` kept unbranded** (`z.string().min(4).max(16)`). The worker stub passes raw `'STUB01'`; branding would force a cast at every API boundary for no real safety win at this stage. Revisit if/when worker generates ids itself.
  - **`ActionLogEntry.kind: z.string().min(1)` and `payload: z.unknown()`** — minimal stub flagged `@needs-confirmation`. Tightens to a discriminated union after #5 ships the full Action schema.
- **Cycle avoidance:** `state.ts` needs `Seat`/`Coord`/`TerrainType`/`Square`/`TileKind`/`TileOrientation`/`Tile` but `index.ts` already re-exports `./state.js`. Importing from `./index.js` would TDZ those schemas (Zod evaluates eagerly at module load, same hazard as the cards.ts/civ.ts split). Fix: locally re-declared the seven schemas inside `state.ts` with a header comment noting they are structurally identical to the index.ts exports and MUST stay in sync — production code should import from the barrel, only `state.ts` itself uses the local copies. Cleaner long-term fix is to extract a `map.ts` leaf, but that's a refactor for a separate issue.
- **`PlayersBySeat` first attempt:** `z.record(Seat, Player)` — failed two tests (`accepts a state with all 4 seats populated`, etc.) with `code: invalid_literal, expected: 1, received: '1'`. Confirmed Zod validates record keys against the schema as-given; numeric-literal unions don't match string keys. Fix described above.
- **`.strict()` on building variants:** Initial implementation used plain `z.object`; tests `rejects Barracks with terrain` and `rejects Capital with terrain` failed because Zod default mode is `.strip()` — unknown keys are silently removed, parse succeeds. Solution: every building variant is `z.object({...}).strict()`. Pattern worth remembering: **when a discriminated-union variant is supposed to forbid a field that another variant has, you MUST `.strict()` the variants. The discriminator alone doesn't enforce field-set boundaries; only `.strict()` does.**
- **Capital HP source:** Rulebook setup (line 77) sets capital to 10 HP base game; long game (line 324) is 20 HP. Schema accepts any `int >= 0`, fixture uses 10. Comment in `Player.capitalHp` references both lines.
- **Hand cap:** Rulebook §6.3 says "your hand can never have more than 7 cards" — enforced at schema level via `z.array(CardId).max(7)` on `Player.hand`. Drawing past 7 is a rules-engine concern (#5), not a schema concern; the schema rejects already-overfull states.
- **Active events cap:** `Player.activeEvents.max(3)` — same rulebook line, "no more than three Event cards in play at once for any one player" (line ~187).
- **Tests passing:** 148/148 in `@eoe/schema`, 4/4 in `@eoe/worker` (including 3 fixture parses), 1/1 in `@eoe/rules`, 7/7 in `@eoe/assets-meta`. All five `tsc --noEmit` typechecks clean.
- **Workspace gotcha (re-confirmed):** Vitest auto-discovers `**/*.test.ts` regardless of tsconfig `include`. The fixture test in `apps/worker/test/` runs fine even without tsconfig changes — but typecheck would skip it. Always update `include` when you add test directories outside `src/`.
- Branch: `copilot/4-schema-gamestate`. PR body includes `Closes #4`, the four pinned decisions, the `@needs-confirmation` on `ActionLogEntry`, and the cycle-avoidance comment about local re-declarations being a temporary structure that #5+ may refactor into a `map.ts` leaf module.

### 2025-11-21: Issue #6 — Rules engine phase machine + legal-action gating

- **Files created:** `packages/rules/src/result.ts` (Result/RuleError/ok/err), `packages/rules/src/phases.ts` (ACTION_PHASE_LEGALITY table + nextPhase/isPhaseLegal/isOpponentTurnAction), `packages/rules/src/applyAction.ts` (the gate + dispatch), `packages/rules/src/__tests__/fixtures.ts` (minimal local GameState), `packages/rules/src/__tests__/phases.test.ts` (81 table-driven gating tests), `packages/rules/src/__tests__/applyAction.test.ts` (11 behavior tests).
- **Files modified:** `packages/rules/src/index.ts` (replaced stub with real re-exports).

#### Architecture decisions pinned in the inbox
- **`Result<T>` and `RuleError` live in `@eoe/rules`, NOT `@eoe/schema`.** Tempting to share via schema but schema describes wire shapes; engine outcomes are an internal contract of the rules layer.
- **`RuleErrorCode` is a closed union:** `not_implemented | wrong_phase | not_your_turn | unknown_action`. Extending it is a deliberate cross-cutting change.
- **`ACTION_PHASE_LEGALITY` is a static table**, not per-handler `if` checks. Single source of truth, and the test suite iterates `ACTION_TYPES × ALL_PHASES` so adding a new action automatically gets phase coverage.
- **`actorId: Seat`, NOT `PlayerId`.** State machine cares about seat number, not account string. Original stub had `actorId: PlayerId` — corrected.
- **EndPhase and EndTurn are split actions.** EndPhase is illegal from `end` (returns `wrong_phase` with message directing to EndTurn). EndTurn is illegal from non-`end`. Two actions, no overload — the type system already enforces it because both are members of the discriminated `Action` union.

#### Reaction semantics
- **`PlayReaction` is the only action mapped to the synthetic `'opponent-turn'` legality marker.** Reactions skip the phase gate entirely and instead require `actorId !== state.activePlayer`. This is the cleanest gate model that doesn't require reaction-window state yet — full reaction-window tracking lifts in a later issue.
- The PhaseLegality type is `TurnPhase | 'opponent-turn'` — keep `'opponent-turn'` out of `TurnPhase` itself so phase transitions stay clean.

#### Seat rotation
- `rotateSeat(state)` walks `SEATS_IN_ORDER = [1,2,3,4]` modulo the array, starting at `(activePlayer mod 4) + 1`, and skips seats not present in `state.players`. Returns `{ next, wrapped }`. **`wrapped` means rotation crossed back through seat 1 — that's the signal to increment `turn`.** Works for 2/3/4-player games without branching by player count.

#### Cleanup hook
- `drawAndDiscardCleanup(state)` is a no-op today. EndTurn always routes through it so when #7 lifts card draw and #8 lifts resource resets, the wiring is local to that function — `applyAction` itself does not change.

#### Purity
- No `fs`/`path`/`fetch`/`crypto`/`Math.random`/`Date.now`. No input mutation — every transition returns a fresh `{...state, ...}` object. Hand-verified during PR review. **Future Cassian-style task:** unit test that grep-scans `rules/src/` for forbidden tokens. Filed mentally; should become a real issue.

#### Test patterns worth remembering
- **Table-driven generation over `ACTION_TYPES`:** `ACTION_TYPES.flatMap(t => ALL_PHASES.map(p => [t, p]))` generates every pair. Filtering out reactions (they have their own seat gate) keeps the table clean. Asserting `ok` OR `not_implemented` (never `wrong_phase`) verifies the gate passed without requiring effects.
- **`stubAction(type)` cast through `unknown`:** The gate only reads `action.type`, so each test can synthesize a minimal `{ type } as unknown as Action`. This avoids manually crafting valid payloads for all 20 action variants in the gate-only tests.
- **Immutability check:** Deep-clone the input with `structuredClone`, run `applyAction`, then `expect(input).toEqual(deepCloneBefore)`. Catches any accidental write to the original.
- **Two-player round-trip:** `advance(actor)` helper runs `EndPhase × 3 + EndTurn` per seat. After two full turns the state must be back to `phase: 'start'`, `activePlayer: 1`, `turn: 2`. Catches off-by-one errors in `wrapped` detection.

#### Workspace gotchas
- **`create_file` cannot overwrite existing files.** When replacing `packages/rules/src/index.ts` (stub) and `packages/rules/src/__tests__/applyAction.test.ts` (wrong old literals), I wrote `*.new` files and used `mv -f` in the terminal. Future: prefer `replace_string_in_file` when only a few lines change; reach for the `.new` + `mv -f` workaround only when the whole file is being replaced.
- **Tests: 92 in `@eoe/rules`, 204 in `@eoe/schema`, 4 in `@eoe/worker`** all green. No regressions anywhere downstream.

- Branch: `copilot/6-rules-phase-machine`. PR #24 (draft). Body includes `Closes #6`, the reviewer notes about boundary placement of `RuleError`, `actorId: Seat` vs `PlayerId`, and the Cassian-style EndPhase-from-end ambiguity pin.

### 2026-05-21: Issue #12 — Worker POST /games + /join (KV-backed game creation)

- **Files added in `apps/worker/`:**
  - `src/http.ts` — `corsHeaders`, `json`, `errorBody` (uniform `{code, error, details?}`).
  - `src/random.ts` — `newGameCode` (6 chars, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no I/O/L/0/1), `newPlayerToken` (32 bytes → base64url), `newSeed` (4 bytes → 8 hex), `sha256Hex` (Web Crypto), `shuffleWith` (Fisher-Yates with explicit `undefined` guards for `noUncheckedIndexedAccess`).
  - `src/game-init.ts` — `buildCreatorState` (seat-1 only, version=1) and `addJoiner` (folds seat 2 in, bumps version). Hand=5, deck=remainder. Civ deck shuffled deterministically via `mulberry32(seedFor({seed, turn:1, activePlayer:1}, 'shuffle:deck:<seat>'))`. Capitals at `(0,0)` and `(5,5)` — flagged `@needs-confirmation`.
  - `src/kv-store.ts` — `StoredGame = { state: GameState; tokenHashes: {1?,2?,3?,4?: string} }`. Key `game:<code>`. Version lives **only** on `state.version`, never duplicated.
  - `src/request-schema.ts` — Zod `CreateGameBody` and `JoinGameBody`, both `.strict()`.
  - `src/routes/create-game.ts` — 5 collision retries before 503 `code_collision`; 400 on bad JSON or schema fail.
  - `src/routes/join-game.ts` — 404 on unknown code, 409 on `state.players[2]` already set.
  - `src/index.ts` (rewritten) — router with OPTIONS preflight, POST `/games`, POST `/games/:code/join`, plus 501 stubs for `/games/:id/actions` (#13) and `GET /games/:id` (#14).
  - `test/post-games.test.ts` — 19 tests covering response shapes, KV writes (Zod-parsed), token-hash flow (sha256, plaintext never persisted), both civs as creator and joiner, version bump 1→2, seat-2 `firstPlayerSecondPlayerWild` flag, capital placement, 409/404/400 errors.
  - `test/helpers/memory-kv.ts` — in-memory `KVNamespace`-shaped stub with `get`/`put`/`delete` plus `peek` and `size` for assertions.
- **Modified:** `apps/worker/package.json` adds `@eoe/assets-meta: workspace:*` (deck data). `apps/worker/wrangler.toml` `ALLOWED_ORIGINS = "https://jasontiedt.github.io,http://localhost:5173"`.
- **Token-hash flow:** `crypto.getRandomValues` → base64url plaintext → `sha256Hex` → store hash in `tokenHashes[seat]`. Plaintext returned **once** in the create/join response, never re-stored. Tests assert the raw token does not appear anywhere in the KV blob.
- **Error response shape:** `{code, error, details?}`. Codes used: `invalid_json`, `invalid_body`, `not_found`, `game_full`, `code_collision`, `not_implemented`.
- **gameCode collision:** loop up to 5 attempts (`gameExists` check); after that, 503. Single retry is the common path — the codespace is ~10⁹.
- **`exactOptionalPropertyTypes` gotcha:** `firstPlayerSecondPlayerWild` is omitted on seat 1 and `true` on seat 2 — I build seat 2 with a conditional spread (`{...player, firstPlayerSecondPlayerWild: true}`) rather than always assigning, otherwise seat 1 ends up with the wrong shape.
- **Deck padding (`@needs-confirmation`):** Byzantines has only 2 cards in `@eoe/assets-meta` data today (1 unit + 1 civ card). I pad to `MIN_DECK_AFTER_DRAW + STARTING_HAND_SIZE = 12` with civ-namespaced placeholders (`<civ>-placeholder-<i>`) so the 5-card draw never under-runs. Will be revisited when card catalogs ship.
- **Workspace dep gotcha:** `pnpm install` in the worktree can't run unattended because it wants to wipe-and-rebuild `node_modules` (the per-package junctions confuse it). Workaround: manually create the missing workspace symlink in the **main checkout** — `ln -s /c/GitRepos/squads-demo/packages/assets-meta/ apps/worker/node_modules/@eoe/assets-meta` — and the worktree picks it up through the junction. Real install will reconcile on the next clean main-repo `pnpm install`.
- **Test counts:** worker **23** (was 4 — +19 new), schema 204, rules 121 (+16 needs-confirmation skipped), assets-meta 17. All green.
- Branch: `copilot/12-worker-post-games`. Decision filed at `.squad/decisions/inbox/artoo-worker-kv-contract.md` documenting KV schema, endpoint contracts, token-hash flow, code alphabet, and the three `@needs-confirmation` items (capital squares, starting tile terrain, deck padding).

## 2026-05-22: Issue #39 — CI e2e workflow
- Added `.github/workflows/e2e.yml` running Playwright on PRs and pushes to main touching apps/web, apps/worker, apps/e2e, packages/, lockfiles.
- Followed deploy-pages.yml conventions: pnpm/action-setup@v4 (no version pin — uses packageManager from root package.json: pnpm@9.12.0), actions/setup-node@v4 with node 20 + pnpm cache.
- Playwright browser cache keyed on pnpm-lock.yaml + apps/e2e/package.json hash so cache invalidates when @playwright/test version bumps.
- 15-minute timeout-minutes. Concurrency group cancels in-progress runs on same ref.
- Artifacts (playwright-report/, test-results/) uploaded only on failure with 7-day retention.
- PR #47 (draft).

### 2026-05-22: Issue #57 — Capital placement + board init extracted to @eoe/rules

- **Files added in `packages/rules/`:**
  - `src/constants.ts` — `CAPITAL_DEFAULT_HP = 20` (rulebook §324 long-game default, per issue #57), `STARTING_HAND_SIZE = 5`, `MIN_DECK_AFTER_DRAW = 7`. All three moved from `apps/worker/src/game-init.ts`.
  - `src/shuffle.ts` — `shuffleWith<T>(items, rng)` moved verbatim from `apps/worker/src/random.ts`. It is a pure engine primitive — belongs next to `mulberry32`/`seedFor`.
  - `src/initialState.ts` — `buildCreatorState(gameCode, seed, civ)` and `addJoiner(state, civ)` moved from worker. Capital ids now `bld-cap-p1` / `bld-cap-p2` (issue spec). Capital HP = `CAPITAL_DEFAULT_HP`. Both starting tiles `faceDown: false`. p1 anchored at (0,0), p2 at (5,5) — placement deterministic, MVP-4 will randomize.
  - `src/__tests__/initialState.test.ts` — 15 tests: round-trip `GameState.parse()`, capital count/owner/id/HP/damage, capital-on-tile assertion (`tileContains(tile, square)`), `units[]` empty, tiles face-up, deterministic across identical inputs, immutability of `addJoiner`'s input, version bump 1→2, seat-2 wild flag.
- **Files rewritten:**
  - `apps/worker/src/game-init.ts` — now a 14-line re-export shim. Existing imports (`'./game-init.js'` from create-game.ts + join-game.ts) keep working without churn.
  - `packages/rules/src/index.ts` — adds `addJoiner`, `buildCreatorState`, `shuffleWith`, `CAPITAL_DEFAULT_HP`, `STARTING_HAND_SIZE`, `MIN_DECK_AFTER_DRAW` exports.
  - `apps/worker/src/random.ts` — `shuffleWith` removed, comment points readers at the new home.
- **Files extended:**
  - `apps/worker/test/post-games.test.ts` — new test "persists both capitals with #57 ids, default HP, and empty units[]". 19 worker post-games tests still pass.
- **Issue-vs-schema reconciliation:** The issue description mentioned `tileId` and `siegeState` on `BuildingInstance`, plus per-player `units[]`. None of those fields exist in the current schema (#4 landed `BuildingInstance` as a discriminated union with `square: Coord` and no siege state; units live on `GameState.units[]`, not per-player). Did NOT add them — that would be schema bloat outside #57's stop condition. The stop condition ("each player has a Capital BuildingInstance on a starting tile and empty units[]") is satisfied as-is: `square` locates the capital on the tile via square-membership, and `GameState.units = []` satisfies "empty units[]". Decision filed at `.squad/decisions/inbox/artoo-capital-init.md`.
- **HP change (10 → 20):** Production init now uses long-game HP. Test fixtures (`apps/worker/test/fixtures/initial-state.ts`, `packages/rules/src/__tests__/fixtures.ts`, `packages/schema/src/__tests__/state.test.ts`) keep `capitalHp: 10` — they are sample-data fixtures, not assertions about init output. They round-trip through `Player.parse()` regardless of the HP value. Touching them would be cosmetic noise.
- **Worktree gotcha (re-confirmed):** pnpm-installed `apps/worker/node_modules/@eoe/{rules,schema,assets-meta}` were REAL directory copies (not symlinks) in the worktree, pointing at the main repo's content. New files in `packages/rules/src/` were invisible to the worker. Fix: `cmd //c "rmdir /S /Q apps\worker\node_modules\@eoe\<pkg>"` then `cmd //c "mklink /J <abs-dst> <abs-src>"`. **Junctions need absolute paths** — `mklink /J` resolves relatives against the cmd CWD, NOT the link's location, so `..\..\..\..\packages\rules` lands in `c:\GitRepos\packages\rules` and silently breaks. Adding this to my memory for future worktree spawns.
- **Test counts:** rules 121 → 136 (+15 new), schema 204 unchanged, worker 43 → 44 (+1 new). All green in scope.
- **Web failures are pre-existing**, NOT regressions: 38 `document is not defined` errors in `apps/web/src/**/*.test.tsx`. `apps/web/` has no `vitest.config.ts` so vitest defaults to node env. Out of scope for #57.
- Branch: `copilot/57-capital-init`. PR drafted with `Closes #57`.
