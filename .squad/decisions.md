# Squad Decisions

## Active Decisions

### 2026-05-20: Echoes of Emperors — locked architecture & MVP-1

**By:** Wedge (Lead/Architect) — via Scribe merge
**What:** Locked the multiplayer stack and MVP-1 scope for Echoes of Emperors. Stack: TypeScript + Vite + React + Zustand on the client, Cloudflare Workers + Workers KV on the server, Zod schemas shared between the two, pnpm workspaces with Vitest. Hosting: GitHub Pages for the frontend, Cloudflare Workers for the API. Game model: 2 normal / up to 4 max players, anonymous identity via `gameCode` + per-player `playerToken` in `localStorage`, async polling-based turn passing, pure-TS rules engine (`applyAction`) shared client + Worker with the Worker's verdict authoritative. MVP-1 acceptance: two browsers join via game code, English vs Byzantines, draw hands, each plays one card, "your turn" handoff works end-to-end.
**Why:** Turn-based card play does not need realtime — async + polling + a stateless function with a KV store is the leanest shape. GH Pages + Cloudflare Workers free tier keeps cost at zero, avoids vendor lock-in, and confines the architecture to two deploy targets and one repo.
**Source:** `.squad/decisions/inbox/wedge-multiplayer-architecture.md` (archived below).

### 2026-05-20: Rulebook synthesis & schema refinements

**By:** Wedge (Lead/Architect) — via Scribe merge
**What:** Synthesized `Rulebook_EN` (full text) and `English_Base_EN` (partial) into concrete game-model facts and schema refinements that extend the locked architecture. Captured: 4-phase turn structure (Start / Mobilization / Deployment / End), full card-category taxonomy (Units, Technology, Tactic, Upgrade, Action, Reaction, Event, Civilization, Conqueror, Starting Scout), per-player state (Capital HP, hand cap 7, no-reshuffle deck, discard, resource tokens with exhaustion, temporary resources, ≤3 active Events, Unit Field with King/Queen pawns), tile-based 6×6 map model (3×3 tiles × 2×2 squares, face-down tiles revealed via Scouting with chosen orientation), two win conditions (Capital to 0 HP or all opponent units eliminated), broadened `Action` discriminated union (Move, Scout, BuildCamp/Barracks, Attack, SwitchAttackMode, Deploy, PlayTactic/Tech/Upgrade/Action/Event/Reaction, Resupply, Recruit, EndPhase/EndTurn), and 10 rulebook ambiguities flagged as future `needs-confirmation` tests. Reactions are schema-shaped for MVP-1 but not yet implemented.
**Why:** The original architecture sketched units/buildings/actions but the rulebook is materially richer; the rules engine and Zod schemas need these refinements before card handlers and the phase machine can be built. Locked stack and MVP-1 scope are unchanged.
**Source:** `.squad/decisions/inbox/wedge-rulebook-synthesis.md` (archived below).

### 2026-05-20: MVP-1 scaffold landed

**By:** Wedge (Lead/Architect) — via Scribe merge
**What:** pnpm monorepo scaffolded per the locked architecture. Apps: `@eoe/web` (Vite + React + Zustand) and `@eoe/worker` (Cloudflare Workers + Wrangler). Packages: `@eoe/schema` (Zod), `@eoe/rules` (pure `applyAction` stub), `@eoe/assets-meta` (CardMeta + loader stub). Root tooling: TS 5.6 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest 2.1, ESLint + Prettier, `.editorconfig`. GitHub Pages workflow deploys `apps/web` via `actions/deploy-pages@v4`; `apps/web/vite.config.ts` sets `base: '/squads-demo/'` and defines `VITE_API_BASE`. Worker stub: `POST /games` (returns stub gameId+token), `POST /games/:id/actions` 501, `GET /games/:id` 501, OPTIONS preflight with CORS from `env.ALLOWED_ORIGINS`. Smoke tests: `applyAction` returns `not_implemented`; Worker CORS preflight returns 204. Next: Artoo (rules + Worker handlers + KV + auth), Lando (UI shell), Sabine (English civ ingest), Cassian (Vitest expansion). First step for everyone after pulling: `pnpm install` from repo root.
**Why:** Each domain owner needs a runnable, type-checking starting point. Workspace builds end-to-end with zero placeholder business logic — only enough to verify wiring before real implementation begins.
**Source:** `.squad/decisions/inbox/wedge-scaffold-complete.md` (archived below).

### 2026-05-20: Card `effect` and `trigger` typed `z.unknown()` for MVP-1

**By:** Artoo (Backend) — issue #3
**What:** Card discriminated union ships with `effect` (and Reaction `trigger`) as `z.unknown()`. The card-handler registry in `@eoe/rules` does not exist yet; locking a payload shape now would force rework when handlers land. **Implication:** Card-effect interpretation is the rules engine's responsibility, not the schema's. Schema describes wire shape only.
**Source:** `.squad/decisions/inbox/artoo-card-effect-typing.md` (merged).

### 2026-05-20: GameState shape — strict union BuildingInstance, ESM-safe schemas

**By:** Artoo (Backend) — issue #4
**What:** `BuildingInstance` is a `z.discriminatedUnion('type', ...)` over `CampInstance | BarracksInstance | CapitalInstance`, each `.strict()`. `UnitInstance` carries `exhausted: boolean` (used by Mobilization gating and now Attack). `state.units` is flat; per-player ownership derived via `unit.owner: Seat`. **Implication:** New building types require schema + union extension + matching handler. Per-player unit arrays are NOT part of the model.
**Source:** `.squad/decisions/inbox/artoo-gamestate-shape.md` (merged).

### 2026-05-20: Result type and phase legality table — single sources of truth

**By:** Artoo (Backend) — issue #6
**What:** `Result<T>`, `RuleError`, `RuleErrorCode` live in `packages/rules/src/result.ts` (NOT in `@eoe/schema`). `RuleErrorCode` taxonomy closed: `'not_implemented' | 'wrong_phase' | 'not_your_turn' | 'unknown_action'`. `ACTION_PHASE_LEGALITY` in `packages/rules/src/phases.ts` is the authoritative per-action phase gate. `applyAction(state, action, actorId: Seat)` — `actorId` is `Seat` (1|2|3|4), NOT `PlayerId`. **Implication:** New actions require both an `ACTION_TYPES` schema entry AND a legality table row. Reactions are phase-agnostic — they gate on `actorId !== activePlayer` instead.
**Source:** `.squad/decisions/inbox/artoo-result-type-and-phase-gating.md` (merged).

### 2026-05-20: UnitAbilityAction.abilityKey stays `z.string().min(1)` — typing deferred

**By:** Artoo (Backend) — issue #5 / PR #23 — `@needs-confirmation`
**What:** `abilityKey` is free-form `string` for MVP. The two long-term options — (a) module-init enum built from card pack, or (b) nested discriminated union with per-ability payloads — both require the card catalog to land first. **Implication:** Ability handlers in `@eoe/rules` interpret `abilityKey` at runtime. When per-ability payloads appear (target lists, area selections), revisit (b).
**Source:** `.squad/decisions/inbox/artoo-unitability-abilitykey-typing.md` (merged).

### 2026-05-21: Worker → KV contract for game lifecycle

**By:** Artoo (Backend) — issue #12
**What:** Locked request/response shapes for `POST /games`, `POST /games/:code/actions`, `GET /games/:code`. KV stores one record per `gameId` keyed by `gameCode`. Token-based auth: `playerToken` in localStorage identifies seat. Worker re-validates every action via `applyAction` (server is authoritative). **Implication:** Any contract change requires coordinated PR across worker + web client.
**Source:** `.squad/decisions/inbox/artoo-worker-kv-contract.md` (merged).

### 2026-05-21: Seeded PRNG primitive + positional hand-cap overflow

**By:** Cassian (Tester) — issue #7
**What:** `mulberry32(seed)` + `seedFor(state, salt)` (FNV-1a mix of `seed | turn | activePlayer | salt`) in `packages/rules/src/rng.ts`. Every caller MUST pass a unique salt; salt reuse is a determinism bug. Hand-cap overflow discards positional trailing cards (`hand.slice(7)`) — flagged `@needs-confirmation` since the rulebook doesn't specify. **Implication:** Card effects requiring randomness import from `@eoe/rules` rng; no `Math.random`/`Date.now` in pure code.
**Source:** `.squad/decisions/inbox/cassian-seeded-prng-and-handcap.md` (merged).

### 2026-05-20: OCR strategy — Tesseract-first with mandatory human verification

**By:** Sabine (Designer) — issue #17
**What:** Image-only PDFs go through Tesseract → JSON scaffold → human spot-check → schema-validated extract. `StartingTiles.pdf` and `Constantinople.pdf` are manual-primary (visual layout); `Byzantines_Base_EN.pdf` is OCR-primary. Rejected: web-scrape (site has no card-level data), pure manual (doesn't scale), Azure DI (overkill, adds cloud dep). **Implication:** Same pipeline applies to HRE/Mongols/Norsemen/Ottomans/Scots base sets.
**Source:** `.squad/decisions/inbox/sabine-ocr-strategy.md` (merged).

### 2026-05-20: `loadCivMeta` returns `readonly Card[]` from `@eoe/schema`

**By:** Sabine (Designer) — issue #11, PR #21
**What:** Loader reads `packages/assets-meta/data/{civ}.json` (envelope `{ _meta, cards }`) and validates each entry against the `Card` discriminated union at load time. Unparseable entries throw (loud failure beats silent drift). **Implication:** All civ data files MUST use the `{ _meta, cards }` envelope; cards are schema-typed end-to-end.
**Source:** `.squad/decisions/inbox/sabine-assets-meta-loader-shape.md` (merged).

### 2026-05-21: English MVP cards data-only — no behavior modules

**By:** Sabine (Designer) — issue #10, PR #26
**What:** Six English unit cards ship as data in `english.json`. Deliberately did NOT create `packages/rules/src/cards/english/<id>.ts` behavior modules — handler vocabulary is still TBD per `artoo-card-effect-typing.md`. Every card carries `cost.breakdown._needsConfirmation: true` with `{ wild: <sum> }` placeholder until OCR splits resource columns. **Implication:** Behavior handlers land per-civ only after the handler shape locks; data-only ingest is the standard.
**Source:** `.squad/decisions/inbox/sabine-english-mvp-cards.md` (merged).

### 2026-05-21: MVP-2 scope locked

**By:** Wedge (Lead) — via Jason
**What:** MVP-2 = Board view + single PlayCard effect + token-auth private hand + CI e2e + English card stubs/OCR + ResourceKind hygiene. 7 issues. Critical path: Board view → PlayCard UI. **Stop condition:** Two players load, click a card, watch board+hand update (optimistic + server-validated), CI e2e green. **Defers:** Durable Objects, Byzantines backfill (MVP-3), manual asset transcription.
**Source:** `.squad/decisions/inbox/wedge-mvp2-scope-locked.md` (merged).

### 2026-05-22: PlayCard UI blocked by hand redaction — worker contract needs `?seat=X` unredact

**By:** Lando (Frontend) — issue #37
**What:** Worker's `redactStateForPublic` strips ALL hands including the requester's own (documented MVP-1 simplification). Client therefore never observes a real `cardId` for its own hand → cannot dispatch `PlayCard`. **Required:** Authenticate requester (token → seat already verified), unredact only that seat's hand. **Implication:** #37 blocked on Artoo/Wedge unredact contract change. Carry into MVP-3 follow-up.
**Source:** `.squad/decisions/inbox/lando-playcard-needs-worker-unredact.md` (merged).

### 2026-05-22: Test fixtures must reference real catalog cards — no invented placeholders

**By:** Artoo (Backend) — hotfix #63 + CI #64
**What:** PR #58 (Byzantines refresh) silently removed placeholder ids that nine `deployUnit` tests depended on, short-circuiting them green. Tests touching the catalog MUST use real ids from `@eoe/assets-meta`. CI gap closed by `unit-tests.yml` (PR #64) running `pnpm -r test` on every PR. **Implication:** Removing/renaming cards in `@eoe/assets-meta` requires local `pnpm -r test` before PR. Prefer cheapest catalog match (e.g., `eng-watchman` for single-resource happy-path).
**Source:** `.squad/decisions/inbox/artoo-test-fixtures-use-real-catalog.md` (merged).

### 2026-05-22: Capital init — `tileId` / `siegeState` / per-player `units[]` deferred to RFC

**By:** Artoo (Backend) — issue #57, PR #61
**What:** `initialState` places one `capital` `BuildingInstance` per player at fixed seats. Three richer concepts implied by the rulebook are NOT in the current schema: `tileId` (tile-level grouping), `siegeState` (siege flag/besieger ref on capital), and per-player `units[]` (currently derived via `unit.owner`). Deliberately not invented piecemeal. **Implication:** Card/handler code needing siege or tile semantics should flag `@needs-rfc` rather than work around; the model lands as a coherent RFC.
**Source:** `.squad/decisions/inbox/artoo-capital-init.md` (merged).

### 2026-05-22: Byzantines 20-card civ-deck stub convention pinned (applies to HRE / Mongols / Norsemen / Ottomans / Scots)

**By:** Sabine (Designer) — issue #58, PR #60
**What:** Byzantines ship as 20 themed cards in `byzantines.json` using `{ _meta, cards }` envelope. Convention for remaining 5 civs: same path/envelope, 20 themed cards, schema-valid, `cost.breakdown = { wild: <sum>, _needsConfirmation: true }`, no behavior modules in `packages/rules/src/cards/<civ>/`. **Implication:** Five remaining civs can land as data-only MVP stubs in parallel without blocking on handler-vocabulary lock. OCR (#17) backfills cost decomposition uniformly.
**Source:** `.squad/decisions/inbox/sabine-byzantines.md` (merged).

### 2026-05-22: Attack handler reuses `UnitInstance.exhausted` — no parallel `actedThisTurn` flag

**By:** Artoo (Backend) — issue #54, PR #65
**What:** Attack handler tracks "unit already acted this turn" by reusing the existing `exhausted: boolean` field rather than introducing a parallel `actedThisTurn` flag. Schema mutation has team-wide blast radius (schema + redact + KV + fixtures); `exhausted` already encodes the concept and clears at turn end. **Implication:** Future action handlers (Move, ability activations) MUST use `exhausted` for "already acted" gating. Finer distinctions require an RFC, not a second flag.
**Source:** `.squad/decisions/inbox/artoo-attack-acted-tracking.md` (merged).

### 2026-05-22: MVP-3 shipped — DeployUnit, Scout, Attack, WinCondition, Capital init, Byzantines, unit-tests CI

**By:** Wedge (Lead) — coordinated via Squad coordinator
**What:** MVP-3 closed in one session. Issues #53 (DeployUnit, PR #59), #54 (Attack, PR #65), #55 (WinCondition, PR #66), #56 (Scout, PR #62), #57 (Capital init, PR #61), #58 (Byzantines civ, PR #60). Hotfix #63 + new `unit-tests.yml` CI (PR #64) close the catalog-fixture CI gap. HEAD on main: `69255ca`. **Implication:** Rules engine now supports the full MVP-3 action surface. PlayCard UI (#37) remains blocked on the worker unredact contract — first priority for MVP-4.
**Source:** Session log `.squad/log/2026-05-22T22-55-00Z-mvp-3-shipped.md`.

### 2026-05-23: Capital tile membership + units[] shape RFC (open for MVP-5)

**By:** Wedge (Lead / Architect) — issue #69, PR #74
**What:** Locked the shape for capital → tile linkage and unit ownership. `state.units` stays flat (`UnitInstance[]` with `owner: Seat`); `CapitalInstance` gains `tileId: TileId` (denormalized link) and `siegeState: 'open' | 'sieged' | 'fallen'`. `Tile.id` promoted to branded `TileId`. New helpers `unitsFor(state, seat)`, `unitsOnTile(state, tileId)`, `capitalOf(state, seat)`, `tileOfSquare(state, c)` ship in `packages/rules/src/queries.ts`. **Rejected alternatives:** on-demand `tileOfSquare` per handler (repeated lookup); `siegeState` on `Player` (wrong cut — siege is building-shaped); per-player `state.players[seat].units[]` (duplicates ownership info, breaks capture/conversion cards, makes global queries two-step); both shapes (drift risk); side-index `unitsBySeat` (same drift risk smaller). **Implication:** Siege card effects, "all your units" patterns, and capital→tile targeting all bind to this shape. Migration is one additive PR (no field removal, no client/worker breakage). Reviewers: Artoo (rules-engine), Cassian (test-shape).
**Source:** `.squad/decisions/inbox/wedge-capital-units-shape.md` (merged).

### 2026-05-23: Arc-test gap — `Attack` against a capital was `not_implemented` (closed by PR #79)

**By:** Cassian (Tester / QA) — issue #73, follow-up issue #78
**What:** During MVP-4 arc-test work (#73), the capital-zero arc could not be exercised end-to-end because `attack.ts` rejected any `Attack` carrying `targetBuildingId` with `not_implemented` (deliberate MVP-3 stub). Capital-HP win was unit-tested via direct state setup only — no real-action path damaged a capital. Cassian flagged this in `playable-arc.test.ts` with `it.skip` + `@needs-confirmation`. Artoo lifted the stub mid-flight in PR #79: `Attack` with `targetBuildingId` now decrements `Player.capitalHp` by `attacker.card[mode]`, exhausts the attacker, and respects Chebyshev range / phase / seat gates. Skipped arc re-enabled. **Implication:** Capital-damage path is now arc-testable. Future "deliberately stubbed handler" gaps caught during integration testing follow the same pattern — flag with `@needs-confirmation`, file a follow-up issue, lift the stub, re-enable.
**Source:** `.squad/decisions/inbox/cassian-arc-bug-attack-capital-not-implemented.md` (merged).

### 2026-05-23: MVP-4 shipped — schema RFC, Move, Attack-vs-Capital, Capital-HP win, integration arcs, interactive board, HUD, E2E baseline

**By:** Wedge (Lead) — coordinated via Squad coordinator
**What:** MVP-4 closed in one coordinated session. 7 PRs merged: #74 (schema RFC, Wedge), #75 (Move handler), #76 (Capital-HP win condition), #77 (integration tests, Cassian), #79 (Attack-vs-Capital, Artoo — lifted #78 blocker), #80 (interactive board, Lando), #81 (HUD, Lando), #82 (E2E baseline, Cassian). Blocker #78 surfaced during #77 arc testing (Attack-vs-building stubbed) and was fixed mid-flight by Artoo (#79), unblocking the skipped capital-zero arc. Multiple silent-success agent recoveries handled by coordinator (Lando on #71 / interactive board, agent on #78, Cassian on initial #72 attempt). Worktree `squads-demo-71` orphaned on disk due to file lock — harmless, will clean on next reboot. **Implication:** Rules engine + worker contract + web client now playable end-to-end through the capital-zero arc. Next: MVP-5 capital RFC migration (apply the locked shape from #69), PlayCard UI worker unredact follow-through.
**Source:** Session log `.squad/log/2026-05-23T19-30-00Z-mvp4-shipped.md`.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

## Decision Detail Archive

### From wedge-multiplayer-architecture.md

### 2026-05-20: Echoes of Emperors — locked architecture & MVP-1

**By:** Wedge (Lead / Architect)
**Status:** Locked. Team executes against this.
**Requested by:** Jason T

## Decisions locked

- **Players:** 2 normal, up to 4 max per game.
- **Identity:** anonymous. `gameCode` (shareable) + per-player `playerToken` in `localStorage`. No GitHub login.
- **Assets:** mirror images from echoesofemperors.com into repo. Sabine owns ingestion.
- **Rules:** enforced in code. Pure-TS rules engine, shared client + Worker.
- **Liveness:** async. Polling only. "Your turn" toast is enough.
- **Stack:** TypeScript + Vite + React + Zustand. Cloudflare Workers + Workers KV. Wrangler for deploys.
- **Hosting:** GH Pages (frontend) + Cloudflare Workers (API). Two deploy targets, one repo.

## 1. Stack

- **Language:** TypeScript everywhere (client, Worker, rules).
- **Frontend:** Vite + React 18. Boring tech here — the *interesting* code is the rules engine.
- **State (client):** Zustand. Tiny, no boilerplate.
- **Styling:** CSS modules + a small token file. No design system for MVP-1.
- **API:** Cloudflare Workers (free tier, 100k req/day). Workers KV for game state — one key per `gameId`.
- **Validation:** Zod schemas shared between client and Worker.
- **Tooling:** pnpm workspaces, Vitest, ESLint, Prettier, Wrangler.

## 2. Repo layout

```
/apps
  /web              # Vite + React frontend (deployed to GH Pages)
  /worker           # Cloudflare Worker (deployed via wrangler)
/packages
  /rules            # Pure TS rules engine — (state, action) => newState | error
  /schema           # Zod types: GameState, Action, Card, Civ
  /assets-meta      # Card/unit JSON metadata (hand-curated from source site)
/assets             # Mirrored images, normalized: /assets/{civ}/{type}/{name}.{ext}
/scripts            # Ingest + tooling scripts
/tests              # Cross-package integration tests
/docs               # Rules notes, source-site references, ADRs
/.squad             # Team memory (existing)
```

## 3. Game state schema (sketch)

```ts
type GameState = {
  gameId: string;            // 6-char code, e.g. "EMPR4Z"
  createdAt: number;
  version: number;           // bumped every write — optimistic concurrency
  phase: "lobby" | "setup" | "playing" | "ended";
  players: Player[];         // 1..4, seat 0 is host
  turnIndex: number;         // index into players[]
  turnPhase: "draw" | "main" | "combat" | "end";
  board: BoardState;         // civ-agnostic; territories, control, resources
  decksByPlayer: Record<PlayerId, Deck>;       // server-only knowledge
  handsByPlayer: Record<PlayerId, CardId[]>;   // redacted in opponent view
  moveLog: Move[];           // append-only history for replay + audit
  winner?: PlayerId;
};

type Player = {
  id: PlayerId;
  seat: 0 | 1 | 2 | 3;
  name: string;
  civ: CivId;                // "byzantines" | "hre" | "mongols" | "norsemen" | "ottomans" | "scots" | "english"
  tokenHash: string;         // sha256(playerToken) — raw token never stored
  connected: boolean;
};
```

Worker returns a **per-player redacted view**: opponents' hands and decks are stripped to counts only.

## 4. Turn-passing flow

1. Active player builds an `Action` locally; client runs rules engine — instant feedback if illegal.
2. Client `POST /api/games/:id/actions` with `{action, playerToken, expectedVersion}`.
3. Worker: load state from KV → verify token + seat + turn → re-run rules engine server-side → on success, write new state with `version+1` (optimistic concurrency, fail loudly on conflict).
4. Worker returns new redacted state to actor.
5. Other clients poll `GET /api/games/:id?since=<version>`:
   - **Active tab:** 5s.
   - **Background tab:** 30s (Page Visibility API).
   - **No change for 5 min:** back off to 60s.
6. On version change → update store → fire "your turn" toast + favicon dot when seat matches.

## 5. Identity model

- **Game creation:** `POST /api/games` → Worker generates 6-char `gameCode` + host's `playerToken` (32 random bytes). Returns both. Client stores `playerToken` in `localStorage` keyed by `gameCode`.
- **Joining:** player visits `/#/join/EMPR4Z`, picks display name + civ, claims next open seat. Worker returns their `playerToken`. Stored in `localStorage`.
- **Auth on every request:** `Authorization: Bearer <playerToken>`. Worker hashes and compares to `tokenHash`. No sessions, no cookies.
- **Lost token = lost seat.** Documented limitation. Recovery is post-MVP.

## 6. Rules engine boundary

`/packages/rules` exports a single pure function:

```ts
applyAction(state: GameState, action: Action, actorId: PlayerId): Result<GameState, RuleError>
```

- No I/O. No `Math.random` — takes a seeded RNG from state. Deterministic.
- Imported by `/apps/web` (instant client validation) **and** `/apps/worker` (authoritative re-validation). **Worker's verdict wins** — client is advisory.
- Card effects live in `/packages/rules/cards/{civ}/{cardId}.ts` as small handler functions registered by id.

## 7. Asset pipeline (Sabine)

- One-time scrape script in `/scripts/ingest-civ.ts` — pulls images + card text from `https://echoesofemperors.com/{civ}/`, normalizes filenames, writes to `/assets/{civ}/{type}/{name}.{ext}` (lowercase, kebab-case).
- Card metadata (name, cost, text, type, civ) emitted as `/packages/assets-meta/{civ}.json`.
- Images committed to repo (GH Pages serves them). Target <200KB per card.
- Attribution at `/assets/CREDITS.md` linking back to the source site.

## 8. Deploy

- **Frontend:** GitHub Action on push to `main` → `pnpm -F web build` → `actions/deploy-pages`. URL: `https://<user>.github.io/squads-demo/`.
- **Worker:** separate `wrangler deploy` from `/apps/worker`. `*.workers.dev` subdomain. CORS allows the GH Pages origin only.
- **Config:** `VITE_API_BASE` baked at build time pointing to Worker URL.

## 9. MVP-1 — first demo-able slice

**Goal:** two players join via game code, English vs Byzantines, draw opening hands, play one card each, "your turn" handoff works end-to-end. No combat, no win condition yet.

| # | Owner   | Item                                                                                           |
|---|---------|------------------------------------------------------------------------------------------------|
| 1 | Wedge   | This decision doc + repo scaffold (pnpm workspace, folders, configs). Done at merge.           |
| 2 | Artoo   | `/packages/schema` Zod types, `/packages/rules` skeleton with `applyAction` + draw/play, Worker handlers (`POST /games`, `POST /actions`, `GET /games/:id`) backed by KV |
| 3 | Lando   | UI shell: lobby/join, board placeholder, hand strip, end-turn button, "your turn" toast + favicon dot, polling hook |
| 4 | Sabine  | Ingest **English** civ end-to-end: images normalized, `english.json` metadata, asset-loader util |
| 5 | Cassian | Vitest harness across packages, `applyAction` test scaffold (10+ rules cases), Worker integration test with Miniflare |
| 6 | Wedge   | Deploy pipeline: GH Pages action + `wrangler deploy` doc + smoke test                          |

**Acceptance:** open two browsers, create game in A, join from B with the code, both see hands, one plays a card, the other gets the toast.

## 10. Risks & open follow-ups

- **Cloudflare account.** Jason needs to create one + connect Wrangler. Blocker for item 6.
- **KV free-tier limits.** 1k writes/day per namespace is generous for turn-based. Polling is read-only. Re-check before adding spectators.
- **Polling cost on idle tabs.** Visibility-aware backoff above mitigates. Revisit if 100k req/day looks tight at 10+ concurrent games.
- **Rules ambiguity from source site.** Expect gaps. Cassian's tests are the spec — when the site is unclear, we pin our interpretation in a test and move on.
- **Asset rights.** Mirroring approved by Jason. `CREDITS.md` + link source on every card view.
- **Token loss UX.** No recovery in MVP-1. Document it; revisit after playtest feedback.

---

## History

### 2026-05-20: Multiplayer architecture for Echoes of Emperors (initial recommendation)

**By:** Wedge (Lead / Architect)
**Status:** Superseded by the locked decision above.

**Decision:** GitHub Pages **frontend** + **Cloudflare Workers (free tier) with Workers KV** as the turn/state store. Async turn-based only. No realtime.

**Why:**
- GH Pages alone is static hosting — no server, no DB, no websockets. "Multiplayer" on GH Pages alone means abusing git (commits/PRs/issues/gists) as a database, which is slow, rate-limited, leaks identity, and gives a terrible UX for non-technical players.
- A card game with discrete turns does not need realtime. Async (player A submits turn → player B is notified → loads state → plays) is the right shape.
- Cloudflare Workers free tier (100k req/day) + KV is generous, no cold starts, no credit card, and keeps the architecture to two pieces: static frontend + one tiny stateless function with a key-value store.
- Identity: short game-code + per-player token (stored in localStorage). No GitHub login required for players. Optional GitHub OAuth later if we want accounts.

**Trade-offs (what we give up):**
- A second deploy target (Cloudflare) beyond GH Pages.
- No realtime spectating or chat without polling/SSE (acceptable — turn-based).
- KV is eventually consistent; fine for turn-based, would not be for realtime.

**Rejected alternatives:**
- *Pure GH Pages + git-as-DB:* fragile, rate-limited, exposes commit identity, poor UX.
- *Firebase / Supabase:* works, but heavier SDK, vendor lock-in, auth complexity we don't need.
- *GH Pages + serverless on Vercel/Netlify:* fine fallback, but Cloudflare Workers + KV is leaner for this shape of workload.
- *Realtime (websockets, WebRTC):* overkill for turn-based card play.

**Open questions for Jason (resolved 2026-05-20 — see locked decision above):**
1. Players per game — **2 normal, up to 4 max.**
2. Identity — **anonymous gameCode + per-player token in localStorage. No GitHub login.**
3. Spectators — **not in MVP. "Your turn" notification is enough.**
4. Asset rights — **OK to mirror from echoesofemperors.com, with attribution.**
5. Rules fidelity — **full rules engine, enforced client + server.**

### From wedge-rulebook-synthesis.md

# 2026-05-20: Rulebook synthesis & architecture refinements

**By:** Wedge (requested by Jason T)
**Source:** `documentation/Rulebook_EN.pdf` (extracted, full text), `documentation/English_Base_EN.pdf` (extracted, partial — enough to confirm card data shape). Byzantines/StartingTiles/Constantinople PDFs are image-only, no extractable text.

## Game model — concrete facts from the rulebook

### Turn structure (4 phases, in order)
1. **Start of Turn** — unexhaust all Main resources and units. Skipped on turn 1.
2. **Mobilization** — board phase. Move units, perform actions (build/attack/ability). Tactic cards may be played here.
3. **Deployment** — card phase. Spend resources to deploy units, technologies, tactics. No unit movement.
4. **End of Turn** — draw to 5 if hand < 5 (else draw 1); discard down to 7. Deck does NOT reshuffle when empty.

### Card categories (more than three)
The prompt sketched units/buildings/actions. The rulebook is richer:
- **Units** — class (Infantry, Cavalry, Archer, Siege, Ship, etc.), cost, movement (points + direction pattern: orthogonal / diagonal / multi-directional), melee attack, ranged attack, health, keywords (Charge, Armor, Anti-X, Long-Range, Naval, Front-Line, Riposte, Recruit, Regenerate, etc.).
- **Technology** — 4 sub-types (per rulebook). Played in Deployment phase only.
- **Tactic** — playable in EITHER Mobilization OR Deployment. Discarded after use.
- **Upgrade** — attaches to a deployed unit; class-restricted unless "any unit". Persistent until unit dies.
- **Action card** — one-time effect, discarded immediately. Some grant Temporary resources and stay until those are spent.
- **Reaction** — played during the OPPONENT's turn. Discarded immediately.
- **Event** — persistent global effect once activated. Max 3 active per player. Voluntarily discardable.
- **Civilization card** — one per player, on the Unit Field, NOT in deck.
- **Conqueror card** — required (deck-building rules) but not specified for base game.
- **Starting Scout** — required, not in normal draw — placed on Capital at setup as a pawn.

Buildings (Camps, Barracks, Capitals) are **NOT cards** — they're tokens placed by unit actions. Capitals are starting pieces; Camps and Barracks are built by units during Mobilization.

### Game state — required fields beyond the prompt sketch
**Per player:**
- Capital life points (D20 counter, starts at 10 base / 20 long).
- Hand (max 7 — hard cap).
- Deck (face-down, ordered, NO reshuffle on empty).
- Discard pile (face-up).
- Unit Field state (pawn slots, occupied/free; King and Queen pawns are unique-per-game and removable).
- Resources: bank of `{food, wood, gold}` Main tokens (each token has exhausted/unexhausted state — these come from Camps), plus Temporary resources attached to specific cards/Civ card with optional `max` capacity, plus Wild tokens.
- Active Events (≤ 3).
- Temporary Wild for player 2 on turn 1.
- Civilization identifier.
- Damage counters supply (D6).

**Per unit-instance on board (deployed):**
- Card ID + pawn slot reference.
- Square coordinate.
- Exhausted flag.
- Damage taken (counter value).
- Attack mode (melee = vertical / ranged = horizontal). Switchable while unexhausted.
- Attached upgrades (list).
- King/Queen pawn attachment (gives +1/+2).

**Per building on board:**
- Type (Camp / Barracks / Capital).
- Owner.
- Square.
- Damage taken.
- For Camps: terrain type (drives resource type), resource tokens currently held.

**Global / shared:**
- Active player.
- Current phase.
- Map: 3×3 grid of **tiles**, where each tile contains 4 squares (so the playable board is effectively 6×6 squares). Tiles can be face-down (undiscovered) or face-up (revealed) with an orientation (rotation: 0/90/180/270).
- Per-square attributes: terrain (plain, mountain, water, river, village, farmland, forest, mine, gold-double on the Constantinople center), occupant (unit / building / empty).
- Turn number, first-player marker, RNG seed.

### Map model
- **Tile-based, square (not hex).** 3×3 tile grid for base game (4×4 for long game). Each tile = 2×2 square subdivision → 6×6 playable squares in base.
- **Tiles are placed face-down at setup** except both starting tiles (face-up, Capital in bottom-left from owner's view).
- Tiles are revealed via Scouting (a unit movement action that auto-stops on entry).
- Tile orientation matters (rotation chosen on reveal).
- Movement is orthogonal/diagonal across squares within and across tiles. Position identifier: `(tileRow, tileCol, squareRow, squareCol)` — or flatten to `(x, y)` over the 6×6 grid for simplicity. Recommend flat `(x, y)` for engine + `tileId/orientation` metadata kept separately for rendering and Scouting.

### Win conditions (two paths)
1. Reduce opponent Capital to 0 HP.
2. Eliminate ALL their deployed units (board has zero of their units).

Game ends immediately on either trigger. (4-player team: triggers on either player of a team.)

### Multiplayer interactions (drives action protocol)
- **Active-turn actions:** move, build, attack (melee/ranged), unit ability, deploy, play technology/tactic, discard for resupply, end-phase, end-turn.
- **Reactions:** opponent plays Reaction cards on your turn. The action protocol MUST support a reaction window after each "trigger" action (attack declared, card played, unit destroyed, etc.). For MVP-1 we can omit reactions but the schema must allow them.
- **Combat is interactive but resolves atomically:** melee-vs-melee deals counter damage simultaneously based on stats — both sides resolve in one action.
- **Events:** persistent state owned by one player but readable by all.
- **Scouting:** the moving player chooses tile orientation on reveal — that's a player choice mid-action.

### Ambiguities found (capture as `needs-confirmation` tests later)
1. Reaction-card timing windows: rulebook says "during opponent's turn" but doesn't enumerate exact triggers. Pin a default: each top-level action opens a reaction window before resolution.
2. "Some cards have two effects, but you can only use one" — per-play choice, presumably; not per-game lock. Pin it.
3. King/Queen pawn deployment: "If your Unit Field is full, you may discard a deployed unit (excluding King/Queen)." Can a unit attached to King/Queen ever be discarded? Implies pawn returns to Unit Field — but King/Queen are one-shot; clarify.
4. Camp resource on first build: "When built, the Camp grants 1 unexhausted resource immediately." Subsequent turns: resource regenerates on unexhaust at Start of Turn? Implied yes (Camps are Main resources), but pin a test.
5. Deck-empty: rulebook explicit — no reshuffle. But discard pile interactions with future cards? Some cards may reference "from discard" — defer until we hit one.
6. Stacking rule for upgrades: "you cannot attach the same upgrade to a unit more than once" — but two copies of the same upgrade card on different units OK? Implied yes. Pin.
7. "Surrounding any Capital" for Barracks placement — surrounding includes diagonal per glossary; confirm this is the read.
8. Scouting onto water: rulebook says "If the first square is water, move your unit back" — does that consume the move? Implies no (movement halts but no exhaust on Scouting). Pin a test.
9. Order of melee counter-damage when both die simultaneously: who "wins" the square? Rulebook: "If the target square is still occupied after the attack, move your unit back." If both die, attacker can occupy. Confirm.
10. Long-Range + Short-Range interaction with diagonals: Short-Range "cannot attack diagonally with Ranged"; how does Long-Range (2 squares away) handle diagonals? Pin.

## Architecture refinements vs `wedge-multiplayer-architecture.md`

(Stack stays locked. These are schema/action-model refinements.)

- **`GameState` schema additions:**
  - `phase: 'start' | 'mobilization' | 'deployment' | 'end'`
  - `players[].capital: { hp: number, square: Coord }`
  - `players[].hand: CardId[]` (max 7)
  - `players[].deck: CardId[]` (no reshuffle)
  - `players[].discard: CardId[]`
  - `players[].resources: { food: ResourceToken[], wood: ResourceToken[], gold: ResourceToken[], wild: ResourceToken[] }` where `ResourceToken = { exhausted: boolean, sourceCampId?: BuildingId }`
  - `players[].temporaryResources: { onCardId: string, type: ResourceType, count: number, max?: number }[]`
  - `players[].activeEvents: CardInstanceId[]` (≤ 3)
  - `players[].unitField: { pawnSlots: PawnSlot[], kingPawnUsed: boolean, queenPawnUsed: boolean }`
  - `units: UnitInstance[]` with `{ id, cardId, owner, square, exhausted, damage, attackMode: 'melee'|'ranged', upgrades: CardId[], pawnBonus?: 'king'|'queen' }`
  - `buildings: BuildingInstance[]` with `{ id, type, owner, square, damage, terrain?: TerrainType }`
  - `map: { tiles: Tile[][], squares: Square[][] }` where `Tile = { id, faceDown: boolean, kind: 'starting'|'highland'|'constantinople', orientation: 0|90|180|270 }` and `Square = { terrain, tileId, x, y }`
  - `firstPlayerSecondPlayerWild: boolean` (turn-1 P2 freebie)
  - `turn: number`, `activePlayer: 0|1`, `seed: string`

- **`Action` discriminated union — broaden beyond the original sketch:**
  - `MoveUnit { unitId, path: Coord[] }`
  - `Scout { unitId, tileId, chosenOrientation }` (sub-step of MoveUnit when first square is face-down)
  - `BuildCamp { unitId, square }`
  - `BuildBarracks { unitId, square }`
  - `RelocateBuilding { buildingId, unitId, newSquare }`
  - `Attack { attackerId, targetId, mode: 'melee'|'ranged' }`
  - `SwitchAttackMode { unitId }`
  - `UnitAbility { unitId, abilityId, params }`
  - `PlayTactic { cardId, params }` (Mob OR Dep phase)
  - `DeployUnit { cardId, pawnSlot, barracksId | capital }`
  - `PlayTechnology { cardId, params }`
  - `PlayUpgrade { cardId, targetUnitId }`
  - `PlayAction { cardId, params }`
  - `PlayEvent { cardId }` / `DiscardEvent { cardInstanceId }`
  - `PlayReaction { cardId, triggerId, params }` — schema-only for MVP-1
  - `Resupply { cardIds: CardId[] }` (village square ability)
  - `RecruitDraw { unitId }` (Recruit keyword action)
  - `EndPhase` / `EndTurn`

- **Phase machine:** rules engine MUST own a finite-state phase progression with legal-action gates per phase. Reactions add an optional "interrupt window" between trigger and resolution — for MVP-1 the window is empty but the type is in.

- **Deck/draw:** explicit no-reshuffle. `drawCard` returns `null` when deck empty; engine continues.

- **Determinism:** Mongols/Norsemen/Scots irrelevant for MVP-1; English vs Byzantines only. Seeded RNG already required by locked decision — confirms.

- **Map-rendering metadata is engine-aware but not engine-decided:** the engine deals in `(x, y)` squares + terrain. Tile rotation is stored but only the rendering layer cares about visuals. Engine reads terrain per square.

## What did NOT change
- Stack locked: TS + Vite + React + Zustand + CF Workers + KV + Zod + pnpm + Vitest.
- Pure rules engine, server-side re-validation, Zod schemas as source of truth.
- 2-player MVP-1 scope (English vs Byzantines, draw → play one card → handoff).

### From wedge-scaffold-complete.md

### 2026-05-20: MVP-1 scaffold landed
**By:** Wedge (Lead/Architect)
**What:** pnpm monorepo scaffolded per the locked architecture decision. Apps `@eoe/web` (Vite + React + Zustand) and `@eoe/worker` (Cloudflare Workers + Wrangler) plus shared packages `@eoe/schema` (Zod), `@eoe/rules` (pure `applyAction` stub), `@eoe/assets-meta` (CardMeta + loader stub). Root tooling: TS 5.6 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest 2.1, ESLint + Prettier, `.editorconfig`. GitHub Pages workflow (`.github/workflows/deploy-pages.yml`) builds `apps/web` and deploys with `actions/deploy-pages@v4`. `apps/web/vite.config.ts` sets `base: '/squads-demo/'` and defines `VITE_API_BASE`. Worker stub implements POST `/games` (returns stub gameId+token), POST `/games/:id/actions` 501, GET `/games/:id` 501, OPTIONS preflight with CORS sourced from `env.ALLOWED_ORIGINS`. Smoke tests in place: rules `applyAction` returns `not_implemented`, worker CORS preflight returns 204.

**Why:** Each domain owner needs a runnable, type-checking starting point. Workspace builds end-to-end with zero placeholder business logic — only enough to verify the wiring.

**Next moves:**
- Artoo: implement `applyAction` (draw / play_card / end_turn) in `@eoe/rules`, wire Worker handlers to KV, add token hash auth.
- Lando: build `@eoe/web` UI shell — lobby, game-code join, board canvas, hand, turn indicator.
- Sabine: scrape echoesofemperors.com, land English civ JSON in `packages/assets-meta/data/english.json`, populate `loadCivMeta`.
- Cassian: expand Vitest coverage — schema round-trips, rules edge cases, worker integration via miniflare.

**First step for everyone after pulling:** `pnpm install` from repo root.
