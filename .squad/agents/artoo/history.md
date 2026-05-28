# Project Context

- **Owner:** Jason T
- **Project:** squads-demo — virtual boardgame on GitHub Pages, turn-based multiplayer, image-rich (maps/units/cards), rules driven by text docs
- **Stack:** TypeScript + Vite + React + Zustand (web) · Cloudflare Workers + KV (api) · Zod schemas shared · pnpm workspaces · Vitest · Playwright
- **Created:** 2026-05-20

## Learnings

Pre-MVP-5 MVP-3 + MVP-4 detail blocks (issues #53–#57, #66, #68, #78) archived to `history-archive.md` on 2026-05-28. Active learnings below.

### 2026-05-28: MVP-6 closed — 8 PRs across 7 slices, all green on main

Shipped: S1 #97/PR#104, S3 #99/PR#106, S4 #100/PR#107, S5 #101/PR#108, S7-A #103/PR#110 (admin seed). S2 #98/PR#105 was Wedge (DSL extension). S6 #102/PR#109 was Lando. S7-B #103/PR#111 (Cassian) shipped as `test.skip` scaffolding — blocked because `BuildCamp` returns `not_implemented` (`applyAction.ts:304`) and `player.resources` starts as `[]` (`initialState.ts:145`), so no UI deploy can land. Follow-ups for MVP-7: **#112** (implement BuildCamp — my domain) and **#113** (extend admin-seed to seed resources/units, recommended first — test-only, smaller). Pattern note: every MVP-6 handler I shipped (PlayUpgrade, PlayTechnology, PlayEvent, PlayReaction) reused the effect dispatcher locked in MVP-5 (#93). Adding verbs is mechanical now.

### 2026-XX-XX: Issue #103 Part A — Admin seed endpoint (PR #110)

- **Worker-only feature.** Spec was tightly scoped: `POST /admin/games/:code/seed` gated by `X-Admin-Secret` header, overwrites both seats' `deck` (in order) and `hand` before any action has been applied. Refused to touch `packages/rules` or `packages/schema` per the issue.
- **Auth pattern (new in this repo):** `Env.ADMIN_SECRET?: string` — Cloudflare secret, set via `wrangler secret put ADMIN_SECRET`, NOT declared in `wrangler.toml [vars]`. When the binding is unset, the endpoint refuses ALL callers (returns 403 `forbidden`). Production deploys that omit the secret intentionally disable the route.
- **Seed invariant key:** `state.moveLog.length === 0` means seedable. After ANY action has been applied (`EndTurn`, `Move`, etc.) a seed would corrupt history. Returns 409 `game_started`. Separately, if seat 2 hasn't joined yet → 409 `not_joined`.
- **Branded ids at boundaries:** Request body uses `z.array(z.string().min(1))`. Cast `as CardId[]` once at the handler boundary, NOT in the Zod schema — keeps the schema honest and the rules engine validates card existence at draw time anyway.
- **`loadGame` does NO Zod parse** (plain `JSON.parse(raw) as StoredGame`). Tests can inject synthetic `moveLog` entries via `kv.put(gameKey(code), JSON.stringify(dirty))` without strict schema validation rejecting the fixture.
- **`ActionLogEntry` shape** (`packages/schema/src/state.ts:337`): `{ at: ISO datetime, seat: Seat, action: Action }`. Synthetic entry for tests: `{ at: '2025-01-01T00:00:00.000Z', seat: 1, action: { type: 'EndTurn' } }`.
- **`exactOptionalPropertyTypes` + optional `ADMIN_SECRET` in test harness:** Cannot set `{ ADMIN_SECRET: undefined }` — must omit the field entirely. Used conditional spread `...(opts && 'adminSecret' in opts ? opts.adminSecret === undefined ? {} : { ADMIN_SECRET: opts.adminSecret } : { ADMIN_SECRET })`.
- **Strict body schemas catch unknown keys:** `.strict()` on the Zod object means clients can't smuggle extra fields. Test case for `{ ...seedBody(), extra: 'nope' }` → 400 `invalid_body` proves the contract.
- **Idempotency test pattern:** `JSON.stringify(kv.peek(...))` twice and compare strings.
- **Followup carry-over to MVP-7:** Cassian's #113 will extend this endpoint to optionally seed `resources` + pre-deployed `units`. Body schema will grow but the auth/invariant/idempotency pattern is reusable.
- Tests: worker 55 → 66 (+11).

## Active Patterns (cross-issue)

- **Worktree workflow:** Each issue gets `c:/GitRepos/squads-demo-<N>/`, junctioned `node_modules` (root + each workspace package). Coordinator stays in main; agents work in worktrees. `git worktree list` before creating to avoid duplicates. **MVP-6 addition:** `apps/e2e/node_modules` must also be junctioned — default 6-path list misses it (Cassian found this on #103).
- **Silent-success pattern:** ~7-10% of background spawns finish file writes but return no text. ALWAYS filesystem-check (`git status`, look for new files/branches) before treating as failure.
- **Decision-inbox vs in-repo flagging:** Architectural decisions go to `.squad/decisions/inbox/artoo-<slug>.md`. Per-file `@needs-confirmation` comments stay inline with the code they qualify.
- **Engine purity invariant:** No `fs/path/fetch/crypto/Math.random/Date.now` in `packages/rules/`. Seeded RNG only. Worker owns I/O and `state.version`.
- **Effect dispatcher pattern (locked MVP-5 #93):** Every new card-kind handler (PlayUpgrade, PlayTechnology, PlayEvent, PlayReaction shipped in MVP-6) reuses the typed-verb dispatcher in `packages/rules/src/effects/`. New verbs added by extending the union + writing a handler.
- **`@needs-confirmation` carry-list:**
  - Capital `tileId`/`siegeState` schema fields (resolved by MVP-6 S1 #97 foundation)
  - Per-player `units[]` model (still game-wide; deferred)
  - Reaction-window state tracking (resolved by MVP-6 S5 #101)
  - Stone resource (still in `ResourceKind`, not in rulebook)
  - Technology subtypes A|B|C|D (unnamed in rulebook)
  - **NEW:** `BuildCamp` not_implemented (`applyAction.ts:304`) blocks any in-game resource generation — filed as #112.
  - **NEW:** `byz-imperial-shield` fixture reaction card (Cassian's e2e seed) marked `_needsConfirmation` in `byzantines.json` — not canonical, exists only for the MVP-6 reaction-arc e2e.

### 2026-05-23 — MVP-4 contributions (summary)

- **PR #75 (#70 Move handler):** action handler shipped, gated by phase / seat / Chebyshev range / exhaustion (reuses `UnitInstance.exhausted` per the locked decision).
- **PR #76 (#68 Capital-HP win condition):** wired into `applyAction.EndTurn`.
- **PR #79 (#78 Attack-vs-Capital):** lifted the deliberate `not_implemented` stub Cassian found mid-flight during #77.
- Rules engine covered the full MVP-4 action surface. Detail blocks archived to `history-archive.md`.

## Learnings — 2025-11-21T17:30:00Z (MVP-5)

### PlayTactic (#86) — implementation notes
- Tactic resolution is structurally identical to PlayAction (#85): hand→discard, payCost, dispatch, atomic rollback on dispatch err. Only catalog kind check differs (`'tactic'` vs `'action'`).
- Tactics have a per-card `playableIn: array(TacticPhase).min(1)` not present on action cards. The handler enforces it after the kind check, before effect parsing. Re-uses existing `wrong_phase` error code.
- Added `not_a_tactic` to `RuleErrorCode` in `result.ts` (paralleling `not_an_action_card`).

### EndTurn buff cleanup (#86)
- Schema's `TemporaryBuff.expires` is currently a single literal `'end-of-turn'`. The defensive filter `b.expires !== 'end-of-turn'` is future-proof against schema relaxation but currently strips ALL temporary buffs.
- Implementation drops the `temporaryBuffs` field entirely when the filtered array is empty (avoids stable-snapshot churn from `[]` vs `undefined` diffs).
- Pinned interpretation: cleanup applies to ALL units regardless of owner. The schema header comment narrows to "active player's units", but enemy debuffs need to expire at the caster's EndTurn or they'd linger. Tagged as `needs-confirmation`.

### Test mocking pattern (new for this repo)
- No `vi.mock` precedent existed in this repo. The PlayTactic happy path requires a typed-effect tactic card, but the real catalog only ships string-effect tactics until #87. Introduced `vi.mock('@eoe/assets-meta', ...)` at the top of `playTactic.test.ts` with a top-level await for `import('../applyAction.js')` to wire the mocked module before the rules code loads. This is the first mocking pattern in `packages/rules` — reuse for future handlers that need typed-effect catalog cards before #87 lands.

### 2025-11-21 — MVP-5 backend complete

Shipped 4 PRs covering the MVP-5 backend:
- **#91 payCost** — pay-first/then-resolve ordering pinned. `temporaryResources` consumed first, main resources next, `wild` falls back across kinds.
- **#92 ?seat= unredact** — seat-scoped hand reveal validated against the seat's player token. Closes carry-over #37.
- **#93 effect dispatcher + PlayAction** — central new machine. Five verb handlers (`effectDraw`, `effectDamage`, `effectHealCapital`, `effectGainTempResource`, `effectBuffUnitStat`) live in `packages/rules/src/effects/`. Generic `playCard.ts` and `PlayCard` action variant DELETED.
- **#94 PlayTactic + EndTurn cleanup** — `temporaryBuffs` field on `UnitInstance` cleared in `drawAndDiscardCleanup`.

**Process lesson — silent-success on #93.** My spawn for PR #93 staged 8 files but ended before commit/push/PR. Coordinator verified the staged work, ran the test suite (green), landed two build fixes, and shipped the PR. **Don't let agent context starve before the `gh pr create` block** — finish with the full ship sequence (test → commit → push → PR) and treat anything earlier as in-flight. If context gets thin, prioritize the PR open over polish.
