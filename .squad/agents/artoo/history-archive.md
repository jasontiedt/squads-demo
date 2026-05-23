# Artoo — History Archive

Older entries archived from `history.md` by Scribe to keep the active file under 15KB.

---

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

### 2026-05-20: Issue #3 — Card kinds discriminated union
- Files: `packages/schema/src/civ.ts` (leaf), `packages/schema/src/cards.ts` (the union), 60 tests.
- **Decision: `effect` and `trigger` are `z.unknown()` for MVP-1.** See merged decision.
- **Reaction is a schema-only stub** for MVP-1. Rules engine does NOT resolve reactions yet.
- **New pattern: leaf-file for circular-import breaking** — when a barrel re-exports a submodule that needs an enum declared in the barrel, extract enum to leaf file (no internal imports).
- **Technology subtypes A|B|C|D** flagged `@needs-confirmation`.

### 2026-05-20: Issue #4 — GameState / Player / UnitInstance / BuildingInstance
- Files: `packages/schema/src/state.ts`, 50 tests, fixture in worker.
- **Decisions (merged):** `BuildingInstance` is `.strict()` discriminated union; `PlayersBySeat` is explicit object with optional seats (NOT `z.record`); `GameId` unbranded; `ActionLogEntry.payload: z.unknown()` `@needs-confirmation`.
- **`.strict()` lesson:** When a discriminated-union variant must FORBID a field another variant has, you MUST `.strict()` the variants. Default `.strip()` silently removes the field and parse succeeds.
- **Cycle avoidance:** locally re-declared map schemas in `state.ts` (header comment marks structural-twin status). Cleaner long-term: extract `map.ts` leaf.
- **Capital HP:** rulebook 10 (base) / 20 (long). Schema accepts any `int >= 0`; fixture uses 10. Production init eventually moved to 20 (see #57 below).
- **Hand cap 7 / Active events cap 3** enforced at schema level.
- **Vitest auto-discovers tests** regardless of tsconfig `include` — still update `include` to keep typecheck honest.

### 2025-11-21: Issue #6 — Rules engine phase machine + legal-action gating
- Files: `packages/rules/src/{result.ts, phases.ts, applyAction.ts}`, 81 gating tests + 11 behavior tests.
- **Decisions merged:** `Result`/`RuleError` live in `@eoe/rules` not `@eoe/schema`; `RuleErrorCode` closed union; `ACTION_PHASE_LEGALITY` static table; `actorId: Seat` not `PlayerId`.
- **Reactions** are phase-agnostic — gate on `actorId !== state.activePlayer`, mapped to synthetic `'opponent-turn'` legality marker.
- **`rotateSeat(state)` returns `{ next, wrapped }`** — `wrapped` signals turn increment. Skips empty seats. Works for 2/3/4-player without branching.
- **`drawAndDiscardCleanup(state)` is the EndTurn extension point** — no-op today, lifts as #7/#8 land.
- **Purity invariants:** no `fs/path/fetch/crypto/Math.random/Date.now`, no input mutation. Hand-verified.
- **Test pattern: table-driven over `ACTION_TYPES × ALL_PHASES`** — adding a new action automatically gets phase coverage.
- **Immutability check via `structuredClone`** + `toEqual(deepCloneBefore)`.
- **`create_file` cannot overwrite** — use `replace_string_in_file` or write `.new` + `mv -f` for full-file replacement.

### 2026-05-21: Issue #12 — Worker POST /games + /join (KV-backed game creation)
- Files: `apps/worker/src/{http.ts, random.ts, game-init.ts, kv-store.ts, request-schema.ts, routes/create-game.ts, routes/join-game.ts, index.ts}`, 19 new tests.
- **KV schema:** `StoredGame = { state: GameState; tokenHashes: {1?,2?,3?,4?: string} }`. Key `game:<code>`. Version lives ONLY on `state.version`.
- **gameCode:** 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no I/O/L/0/1). 5 collision retries → 503 `code_collision`.
- **Token-hash flow:** plaintext base64url returned once; only `sha256Hex` persisted. Tests assert plaintext absent from KV blob.
- **Error response shape:** `{code, error, details?}`. Codes: `invalid_json`, `invalid_body`, `not_found`, `game_full`, `code_collision`, `not_implemented`.
- **Deck shuffled deterministically** via `mulberry32(seedFor({seed, turn:1, activePlayer:1}, 'shuffle:deck:<seat>'))`.
- **Deck padding `@needs-confirmation`:** Pad civ decks to `MIN_DECK_AFTER_DRAW + STARTING_HAND_SIZE = 12` with `<civ>-placeholder-<i>` ids when source data is thin. Revisited when card catalogs ship.
- **`exactOptionalPropertyTypes` gotcha:** `firstPlayerSecondPlayerWild` must be conditionally-spread (`{...player, firstPlayerSecondPlayerWild: true}`) not always-assigned, so seat 1 gets the correct absent-key shape.
- **Workspace dep gotcha:** Worktree `pnpm install` wants to rebuild `node_modules` and breaks junctions. Workaround: manually symlink `apps/worker/node_modules/@eoe/<pkg>` in the main checkout; worktree picks it up.
- Decision: `.squad/decisions/inbox/artoo-worker-kv-contract.md` (merged).

### 2026-05-22: Issue #39 — CI e2e workflow (PR #47)
- `.github/workflows/e2e.yml` runs Playwright on PRs and pushes to main touching apps/web, apps/worker, apps/e2e, packages/, lockfiles.
- pnpm/action-setup@v4 (no version pin — uses packageManager from root package.json), actions/setup-node@v4 with node 20 + pnpm cache.
- Playwright browser cache keyed on pnpm-lock.yaml + apps/e2e/package.json hash.
- 15-min timeout. Concurrency cancels in-progress runs on same ref. Artifacts (playwright-report/, test-results/) uploaded only on failure, 7-day retention.

---

For active history, see `history.md` in this directory.
