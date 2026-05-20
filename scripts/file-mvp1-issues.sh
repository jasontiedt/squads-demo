#!/usr/bin/env bash
# Files MVP-1 issues for squads-demo.
# Each issue gets the `squad` label only — Wedge will triage and assign squad:{member}.
set -euo pipefail

REPO="jasontiedt/squads-demo"
ARCH=".squad/decisions/inbox/wedge-multiplayer-architecture.md"
SYNTH=".squad/decisions/inbox/wedge-rulebook-synthesis.md"
TEAM=".squad/team.md"

# Common footer for every issue
FOOTER=$(cat <<EOF

---
**References**
- Architecture (locked): \`$ARCH\`
- Rulebook synthesis: \`$SYNTH\`
- Team & routing: \`$TEAM\`

**Conventions**
- TS strict mode is on (\`noUncheckedIndexedAccess\`, \`exactOptionalPropertyTypes\`). No \`any\`, no \`!\`.
- \`packages/rules\` stays pure: no I/O, seeded RNG only, deterministic.
- Schemas live in \`packages/schema\` (Zod). Types are inferred — don't duplicate.
- Branch: \`squad/{this-issue-number}-{slug}\`. PR body: \`Closes #N\`.
EOF
)

mkfile() {
  local n="$1" title="$2" body="$3"
  printf '%s\n\n%s\n%s\n' "$title" "$body" "$FOOTER" > "/tmp/issues/${n}.md"
}

# ---------- Schema track ----------

mkfile 01 "Schema: Coord, Tile, Square, Terrain types" "$(cat <<'EOF'
**Suggested owner:** Artoo · **Size:** S · **Depends on:** none

Define the foundational map / coordinate types in `packages/schema`.

**Acceptance criteria**
- Zod schemas exported from `@eoe/schema`:
  - `Coord` — `{ x: number, y: number }` with bounds 0..5 (base map = 6×6 squares)
  - `TerrainType` — union of `'plain' | 'mountain' | 'water' | 'river' | 'village' | 'farmland' | 'forest' | 'mine' | 'gold-double'`
  - `Square` — `{ coord: Coord, terrain: TerrainType }`
  - `Tile` — `{ id: string, kind: 'starting' | 'highland' | 'constantinople', orientation: 0 | 90 | 180 | 270, faceDown: boolean, squares: Square[] }` (each tile is 2×2 squares)
- Types are *inferred* from schemas (no parallel TS interfaces).
- Vitest round-trip parse + invalid-input reject tests pass.

**Out of scope:** populating real tile data — that comes from PDF OCR (separate issue).
EOF
)"

mkfile 02 "Schema: ResourceToken & Temporary resources" "$(cat <<'EOF'
**Suggested owner:** Artoo · **Size:** S · **Depends on:** #1

The rulebook's resource model is **per-token, not a count**. Each Main resource has exhausted/unexhausted state and a source Camp. Temporary resources attach to specific cards.

**Acceptance criteria**
- Zod schemas exported from `@eoe/schema`:
  - `ResourceTokenId` — branded string
  - `ResourceKind` — terrain-derived (matches Camp source: `'wood' | 'stone' | 'food' | 'gold' | 'wild'` — confirm exact set against rulebook synthesis)
  - `ResourceToken` — `{ id, kind, exhausted: boolean, sourceCampId?: string }`
  - `TemporaryResource` — `{ id, kind, attachedToCardId: string, max?: number, current: number }`
- Vitest tests cover: token exhaust/unexhaust round-trip, temporary resource overflow vs `max`, missing `sourceCampId` for non-camp tokens (e.g. starting wild).

**Notes**
- Player 2 gets a turn-1 temporary Wild — track on player, not as a token.
EOF
)"

mkfile 03 "Schema: Card kinds (Unit, Technology, Tactic, Upgrade, Action, Reaction, Event, Civilization)" "$(cat <<'EOF'
**Suggested owner:** Artoo · **Size:** M · **Depends on:** #2

Define the **discriminated union** over card kinds. Buildings (Camp/Barracks/Capital) are NOT cards — they're tokens.

**Acceptance criteria**
- Zod discriminated union on `kind` covering: `unit | technology | tactic | upgrade | action | reaction | event | civilization`.
- Per-kind required fields:
  - `unit` — `cost`, `movement: { points: number, pattern?: 'short' | 'long' }`, `melee: number`, `ranged: number`, `health: number`, `class: string[]`, `keywords: string[]`
  - `technology` — `cost`, `subType: 'A'|'B'|'C'|'D'` (confirm names from rulebook), `effect` (loose for now)
  - `tactic` — `cost`, `playableIn: ('mobilization'|'deployment')[]`
  - `upgrade` — `cost`, `restrictedToClass?: string[]`, `effect` (loose)
  - `action` — `cost`, `effect` (loose)
  - `reaction` — `cost`, `trigger` (loose), `effect` (loose) — schema-only stub for MVP-1
  - `event` — `cost`, `persistent: true`, `effect` (loose)
  - `civilization` — `civId`, `effect` (loose); never in deck, sits on Unit Field
- Common fields: `id`, `name`, `civ?`, `flavor?`, `imageRef?`.
- Vitest happy + reject tests for each kind.

**Out of scope:** Conqueror cards (deck-building), specific effect implementations.
EOF
)"

mkfile 04 "Schema: GameState, Player, UnitInstance, BuildingInstance" "$(cat <<'EOF'
**Suggested owner:** Artoo · **Size:** M · **Depends on:** #3

Full `GameState` Zod schema, the canonical persistence shape.

**Acceptance criteria**
- Schemas exported from `@eoe/schema`:
  - `Player` — `{ seat: 1|2|3|4, civ: CivId, capitalHp: number, capitalSquare: Coord, hand: CardId[] (max 7), deck: CardId[], discard: CardId[], resources: ResourceToken[], temporaryResources: TemporaryResource[], activeEvents: CardId[] (max 3), unitField: { kingPawnUsed: boolean, queenPawnUsed: boolean }, civCardId, firstPlayerSecondPlayerWild?: boolean }`
  - `UnitInstance` — `{ id, cardId, owner: Seat, square: Coord, exhausted: boolean, damage: number, attackMode: 'melee'|'ranged', upgrades: CardId[], pawnBonus?: 'king'|'queen' }`
  - `BuildingInstance` — `{ id, type: 'camp'|'barracks'|'capital', owner: Seat, square: Coord, damage: number, terrain?: TerrainType }` (terrain only on Camp)
  - `GameState` — `{ version: number, gameId: string, seed: string, phase: 'start'|'mobilization'|'deployment'|'end', activePlayer: Seat, turn: number, players: Record<Seat, Player>, units: UnitInstance[], buildings: BuildingInstance[], map: { tiles: Tile[] }, moveLog: ActionLogEntry[], pendingReactionWindow?: { triggeredBy: ActionLogEntry } }`
- A sample fixture (`apps/worker/test/fixtures/initial-state.ts`) parses cleanly.
- Vitest round-trip + each-required-field-rejection tests.

**Notes**
- `Action` union lands in #5 (intentionally split — keep this PR focused).
EOF
)"

mkfile 05 "Schema: Action discriminated union (~18 types)" "$(cat <<'EOF'
**Suggested owner:** Artoo · **Size:** M · **Depends on:** #4

Define every legal player action. Reaction is schema-only for MVP-1.

**Acceptance criteria**
- Zod discriminated union on `type` covering at minimum:
  - **Mobilization phase:** `MoveUnit`, `Scout`, `BuildCamp`, `BuildBarracks`, `RelocateBuilding`, `Attack` (with `mode: 'melee'|'ranged'`), `SwitchAttackMode`, `UnitAbility`, `Resupply`, `RecruitDraw`, `PlayTactic`
  - **Deployment phase:** `DeployUnit`, `PlayTechnology`, `PlayUpgrade`, `PlayAction`, `PlayEvent`, `DiscardEvent`, `PlayTactic` (also)
  - **Opponent's turn:** `PlayReaction` (schema-only stub)
  - **Phase control:** `EndPhase`, `EndTurn`
- Each action carries the minimal payload (e.g. `MoveUnit` → `{ unitId, from: Coord, to: Coord }`).
- Vitest parse-success + reject-bad-shape tests for every action type.

**Out of scope:** any execution semantics — that's the rules engine (#6+).
EOF
)"

# ---------- Rules engine track ----------

mkfile 06 "Rules engine: phase machine + legal-action gating" "$(cat <<'EOF'
**Suggested owner:** Artoo · **Size:** M · **Depends on:** #5

`applyAction` becomes a real function with phase-gated routing. Effects come later — this issue is about *gating*.

**Acceptance criteria**
- `applyAction(state, action, actorId): Result<GameState, RuleError>` rejects out-of-phase actions with `{ code: 'wrong_phase', message }`. Examples:
  - `MoveUnit` during Deployment → reject
  - `DeployUnit` during Mobilization → reject
  - `PlayTechnology` during Mobilization → reject (only Deployment)
  - `EndPhase` advances phase: start → mobilization → deployment → end → start (next player)
  - `EndTurn` runs end-of-turn cleanup hooks (stub for now: hand-cap check + draw call placeholder; real draw lands in #7)
- All transitions stay pure + deterministic. No I/O.
- Vitest tests for each phase × each action's gate.

**Out of scope:** actual effect implementations. Most actions return `{ code: 'not_implemented' }` after gate passes.
EOF
)"

mkfile 07 "Rules engine: deck + draw + hand-cap (no-reshuffle)" "$(cat <<'EOF'
**Suggested owner:** Cassian · **Size:** S · **Depends on:** #6

Implement the deck/draw mechanics. Drives end-of-turn handoff.

**Acceptance criteria**
- `drawCard(state, seat): { state, drawn: CardId | null }` — returns `null` when deck is empty (NO reshuffle from discard, per rulebook).
- End-of-turn rule: if hand < 5, draw to 5; if hand ≥ 5, draw +1; then discard down to 7. Implemented as part of `EndTurn` handling in `applyAction`.
- All RNG seeded from `state.seed`. Same state + action → same result.
- Vitest tests:
  - draw decrements deck, increments hand
  - empty deck → null
  - end-of-turn fills to 5 from 2
  - end-of-turn +1 from hand of 6
  - hand cap 7 → discards to 7 deterministically (oldest? player choice? — flag in `needs-confirmation` if rulebook is silent)

**Notes**
- Coordinate with #9: any ambiguity becomes a `needs-confirmation` test, not a guess in code.
EOF
)"

mkfile 08 "Rules engine: DeployUnit minimal path (Capital pawn only)" "$(cat <<'EOF'
**Suggested owner:** Artoo · **Size:** M · **Depends on:** #7

The first real action with full effects — enough to play one card from hand.

**Acceptance criteria**
- `DeployUnit` action: spend exact resources from player's `ResourceToken[]` (mark exhausted), remove card from hand, append to `units[]` placed on Capital pawn slot, increment unit-id counter.
- Reject if: insufficient resources, card not in hand, card kind ≠ unit, deploy phase not active, Capital pawn slot full.
- **MVP-1 deploy is Capital-only** — Barracks deployment is in the backlog.
- Determinism preserved.
- Vitest tests:
  - happy path: Watchman (1 wood) deployed when wood available
  - insufficient resources rejected with `{ code: 'insufficient_resources' }`
  - card not in hand rejected
  - non-unit card rejected
  - Capital pawn full → rejected (multiple seats around capital)

**Out of scope:** King/Queen pawn attach (backlog), Barracks deploy (backlog), upgrade attach (backlog).
EOF
)"

mkfile 09 "needs-confirmation test suite: 10 rulebook ambiguities" "$(cat <<'EOF'
**Suggested owner:** Cassian · **Size:** S · **Depends on:** #6

Pin every rulebook ambiguity as a test with a default interpretation, tagged for Jason's confirmation.

**Acceptance criteria**
- Vitest suite at `packages/rules/src/__tests__/needs-confirmation.test.ts`.
- Each test:
  - Uses `it.skip` OR `describe.skipIf` with a `// @needs-confirmation: <one-line question>` comment.
  - Pins a default interpretation as the assertion (so when un-skipped, it locks the behavior).
- Captures these 10 from `wedge-rulebook-synthesis.md`:
  1. Reaction timing windows (sub-phase order)
  2. "Two-effect" cards — per-play or per-game?
  3. King/Queen-attached unit discard behavior
  4. Camp resource regeneration semantics
  5. Scouting-onto-water cost
  6. Upgrade stacking across multiple units
  7. "Surrounding Capital" diagonal interpretation
  8. Melee mutual-kill — who occupies the square?
  9. Long-Range diagonal vs Short-Range interaction
  10. Deck-empty discard interactions
- CI surfaces them in PR description (a comment `<!-- needs-confirmation: 10 open -->`).
- README in `packages/rules` lists how to confirm one (un-skip + explicit assertion + decision in `.squad/decisions/inbox/`).

**Notes**
- This is a Cassian reviewer responsibility going forward — every ambiguous rule found gets a test here BEFORE implementation.
EOF
)"

# ---------- Cards / data track ----------

mkfile 10 "English MVP card subset (~6 unit cards) + metadata" "$(cat <<'EOF'
**Suggested owner:** Sabine · **Size:** M · **Depends on:** #3

Define enough English cards to play a turn. Implementations stay minimal — full effects come later.

**Acceptance criteria**
- For each of: **Watchman, Billman, Welsh Infantry, Longbowman, Esquire, English Knight**:
  - File `packages/rules/src/cards/english/<cardId>.ts` that registers the card via side-effect import.
  - Card metadata in `packages/assets-meta/data/english.json` (name, cost, stats, image filename, flavor — stats sourced from `documentation/English_Base_EN.pdf`).
  - Image file placeholder under `apps/web/public/cards/english/<cardId>.png` (real art comes from #17 / OCR pass — placeholder is fine for MVP-1).
- `loadCivMeta('english')` returns the 6 entries.
- Stats validated against the partial English PDF extract.
- Vitest tests confirm registration succeeds and `getCardById` returns expected shape.

**Notes**
- Card stats taken from rulebook + `English_Base_EN.pdf`. If a stat is unclear, file a `needs-confirmation` test (#9), don't guess.
EOF
)"

mkfile 11 "Byzantines stub (placeholder unit + civ card)" "$(cat <<'EOF'
**Suggested owner:** Sabine · **Size:** S · **Depends on:** #3

Byzantines deck PDF is image-only — full ingest is blocked on OCR (#17). For MVP-1 we need *just enough* to start a 2-player game.

**Acceptance criteria**
- One placeholder Byzantine unit card (e.g. "Byzantine Infantry Placeholder") with **clearly placeholder stats** (cost: 1, melee: 1, health: 2 — flagged in flavor as "placeholder pending OCR").
- One Byzantine civilization card stub.
- Files marked with `// TODO: replace with real Byzantine data after #17 (image-only PDF OCR)`.
- `loadCivMeta('byzantines')` returns the 2 entries.
- README note in `packages/assets-meta/data/byzantines.json` documents the placeholder status.

**Out of scope:** real Byzantine cards. That's blocked by #17.
EOF
)"

# ---------- Worker track ----------

mkfile 12 "Worker: POST /games — create + initial state in KV" "$(cat <<'EOF'
**Suggested owner:** Artoo · **Size:** M · **Depends on:** #8, #10, #11

The first real Worker endpoint — creates a game and seeds initial state.

**Acceptance criteria**
- `POST /games` with body `{ playerName: string, civ: CivId }` returns `{ gameCode: string, playerToken: string, seat: 1 }`.
- A second `POST /games/:code/join` with `{ playerName, civ }` returns `{ playerToken, seat: 2 }`. Rejects if game full or already started.
- KV write keyed `game:<code>` containing the full `GameState`:
  - 6-char alphanumeric game code (collision-checked)
  - 32-byte player tokens (sha256 hash stored, raw token returned once)
  - Seeded RNG derived from a fresh seed; both decks shuffled
  - 5-card opening hands per player
  - Player 2 `firstPlayerSecondPlayerWild = true`
  - Phase: `start`, activePlayer: seat 1, turn: 1
  - Capitals placed at opposite ends of map (specific squares — pin in `needs-confirmation` if rulebook silent)
- CORS locked to `https://jasontiedt.github.io` (configurable via env var for local dev).
- Miniflare integration test: create → join → GET state → both seats present, hands sized 5.

**Out of scope:** action handling — that's #13.
EOF
)"

mkfile 13 "Worker: GET /games/:id and POST /actions with optimistic versioning" "$(cat <<'EOF'
**Suggested owner:** Artoo · **Size:** M · **Depends on:** #12

The action endpoint is the multiplayer heartbeat.

**Acceptance criteria**
- `GET /games/:code` requires `Authorization: Bearer <playerToken>`. Returns **redacted state**: own hand revealed, opponent's hand replaced with count only; opponent deck shown as count; everything else unchanged. Includes `version`.
- `POST /games/:code/actions` with `{ action, expectedVersion }`:
  - 401 if token invalid
  - 403 if it's not actor's turn (or action requires opponent's turn for Reaction)
  - 409 if `expectedVersion !== state.version` (stale write)
  - 422 if `applyAction` returns an error (with `{ code, message }`)
  - 200 with new redacted state on success — `version` incremented
- Worker re-runs `applyAction` server-side regardless of what the client says. Worker is authoritative.
- Miniflare tests:
  - happy path: deploy unit → state advances, version +1
  - stale version → 409
  - wrong turn → 403
  - bad token → 401
  - rules error → 422 with code

**Notes**
- Polling cadence is the client's job (#15).
EOF
)"

# ---------- Web track ----------

mkfile 14 "Web shell: join-by-code + player token persistence" "$(cat <<'EOF'
**Suggested owner:** Lando · **Size:** S · **Depends on:** #12

Minimal lobby flow. No game UI yet — that's #15.

**Acceptance criteria**
- Two routes (hash router or react-router):
  - `/` — "Create game" (pick name + civ → POST /games → redirect to `/g/:code`) and "Join game" (paste code + name + civ → POST /games/:code/join → redirect to `/g/:code`)
  - `/g/:code` — placeholder showing `gameCode`, `seat`, current `phase`, `activePlayer`, and "you are seat N" indicator
- `playerToken` stored in `localStorage` keyed by `gameCode` (one entry per game).
- Zustand store wired with `gameState`, `playerToken`, `seat`, `pollState` (idle/active/error).
- `VITE_API_BASE` consumed; deployed build hits CF Worker URL.
- Basic styling — readable, no design polish (Sabine handles polish later).

**Out of scope:** hand UI, polling, "your turn" toast — that's #15.
EOF
)"

mkfile 15 "Web: hand UI + play card + your-turn polling" "$(cat <<'EOF'
**Suggested owner:** Lando · **Size:** M · **Depends on:** #13, #14

The demo experience.

**Acceptance criteria**
- Render own hand from card metadata (`@eoe/assets-meta`). Show name, cost, stats, image (placeholder OK).
- Click a unit card during your Deployment phase → `POST /actions` with `DeployUnit` payload. Disabled card (greyed) when not your turn / wrong phase / unaffordable.
- "End Phase" + "End Turn" buttons.
- Polling hook: 5s when tab active, 30s when hidden (Page Visibility API), 60s after 5min idle. Re-poll immediately on user action.
- "Your turn" indicator: toast on transition to your turn + favicon dot (canvas-drawn red circle).
- Optimistic UI optional — server is authoritative; rollback on 422.
- Manual smoke: open two browsers, create game in A, join from B, P1 deploys a unit, P2 sees the unit + gets the toast.

**Notes**
- Coordinate with #16 (Cassian) for the demo recording.
EOF
)"

# ---------- Demo ----------

mkfile 16 "E2E demo: two browsers, create → join → play → handoff" "$(cat <<'EOF'
**Suggested owner:** Cassian · **Size:** S · **Depends on:** #15

The MVP-1 acceptance moment — recorded for posterity.

**Acceptance criteria**
- Either Playwright script (`apps/web/e2e/mvp1.spec.ts`) OR a documented manual script in `docs/demo.md` with screenshots/screen recording.
- Steps verified end-to-end:
  1. Open browser A, create game with English. Capture `gameCode`.
  2. Open browser B (incognito), join with `gameCode` as Byzantines.
  3. P1 sees own hand of 5; P2 sees own hand of 5; P1 sees opponent hand as count of 5.
  4. P1 advances start → mobilization → deployment, deploys an English Watchman to Capital. P2 sees the unit appear within polling interval.
  5. P1 ends turn. P2 sees "your turn" toast + favicon dot.
  6. P2 deploys a placeholder Byzantine unit. P1 sees it.
- `docs/demo.md` linked from README.

**MVP-1 is shipped when this issue closes.**
EOF
)"

# ---------- Backlog issue (post-MVP) ----------

mkfile 17 "OCR / ingest image-only PDFs (Byzantines, StartingTiles, Constantinople)" "$(cat <<'EOF'
**Suggested owner:** Sabine · **Size:** L · **Depends on:** none (parallel) · **Milestone:** post-MVP-1

Three documentation PDFs are image-only — no extractable text. Blocks full Byzantine deck and accurate map terrain data.

**Acceptance criteria**
- Pick + document an OCR strategy (Tesseract local, Azure Document Intelligence, manual data entry from echoesofemperors.com — Sabine decides). Trade-off note in `.squad/decisions/inbox/sabine-ocr-strategy.md`.
- For each PDF, produce machine-readable output:
  - `documentation/extracted/Byzantines_Base_EN.json` — full card list with stats matching the schema from #3
  - `documentation/extracted/StartingTiles.json` — tile layouts with terrain per square
  - `documentation/extracted/Constantinople.json` — Constantinople tile layout
- Validation script (`scripts/validate-extracted.ts`) confirms shape against `@eoe/schema`.
- Spot-check by Jason: 5 random cards / 1 tile from each PDF reviewed visually.
- Replace placeholders from #11 with real Byzantine cards once data is verified (separate follow-up PR).

**Notes**
- This is a backlog item — file Wedge can pull when MVP-1 ships. Do NOT block MVP-1 on this.
- Asset rights: confirmed OK to mirror per Jason (2026-05-20).
EOF
)"

# ---------- Now file them all ----------

for n in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17; do
  f="/tmp/issues/${n}.md"
  title=$(head -1 "$f")
  body=$(tail -n +3 "$f")
  url=$(gh issue create --repo "$REPO" --title "$title" --body "$body" --label "squad" 2>&1 | tail -1)
  printf '#%s  %s  ->  %s\n' "$n" "$title" "$url"
done

echo "---"
echo "Done. Listing open issues:"
gh issue list --repo "$REPO" --state open --limit 30
