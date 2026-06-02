# MVP-4 scope proposal — Echoes of Emperors

**Author:** Wedge (Lead / Architect)
**Date:** 2026-05-22T23:00:00Z UTC
**HEAD:** `4c6e8b9` on `main`
**Status:** Draft for Jason's review — NO issues filed yet.

---

## TL;DR

MVP-4 is **"Playable Board"** — the rules engine grows the last action it
needs (`Move`) and the Capital-HP win path lands, then the web app
becomes interactive enough to drive a full 2-player game through the
existing rules surface. **The coordinator's hypothesis is partially
rejected.** The board-UI half is right. The "card effect handlers" half
is not — handler vocabulary is still un-locked
(`artoo-card-effect-typing.md`), card data is `_needsConfirmation` for
real cost shapes, and bundling vocab-lock + per-card behavior + board
UI is too wide for one MVP. Card effects are MVP-5, gated on a vocab
RFC that I'll draft separately.

Stale-info correction: `#37` PlayCard UI and `#38` worker
unredact-by-seat are **both closed already** (verified via
`gh issue list`). They are NOT MVP-4 work. My own history entry from
the MVP-3 ship log was wrong about that — corrected here.

**Stop condition for MVP-4 overall:** two browsers can play a full
2-player game where a unit deploys, moves toward the opposing Capital,
attacks it, reduces its HP to zero, and the second player sees a
"You lost" banner — without anyone hitting a "not_implemented" wall.

---

## Dependency graph (one line)

`[1 Move-handler] ∥ [2 CapitalHP-win] → [3 Interactive-board] → [4 HUD-polish] ∥ [5 Schema-RFC] → [6 E2E-playable] ← [7 Rules-coverage]`

(`∥` = parallel-safe. `→` = hard dep.)

---

## Items (7 GitHub-issue-shaped)

### 1. Rules: `Move` action handler

**Owner:** Artoo. **Deps:** none. **Size:** ~1 day.

The last missing core action. Units currently deploy and attack from
where they land — they never traverse the 6×6. Without Move, a unit
deployed adjacent to its own Capital cannot reach the opposing Capital,
which means the demo cannot end naturally.

**Acceptance:**

- `Move` action gated by `ACTION_PHASE_LEGALITY` to `deployment` phase
  (same as Attack).
- Distance ≤ `unit.movement.points` (Chebyshev — orthogonal+diagonal
  count as 1, matching the square grid).
- Blocked: water, mountain terrain; squares occupied by any unit
  (friend or enemy). Returns `err('illegal_move', …)`.
- Sets `unit.exhausted = true` on success (same flag Attack uses — no
  parallel `actedThisTurn` field; see prior decision).
- Tests in `packages/rules/src/__tests__/move.test.ts` covering: happy
  path, range limit, terrain block, occupied block, exhaustion gate,
  wrong-phase, wrong-seat.

**Out of scope:** `movement.pattern: 'short' | 'long'` distinction —
defer to MVP-5 with naval units. For MVP-4, all units use Chebyshev
points regardless of pattern.

---

### 2. Rules: Capital-HP win condition + EndTurn integration

**Owner:** Artoo. **Deps:** none. **Size:** ~½ day. **Discharges debt
from #55** (explicitly punted at MVP-3 close).

`Attack` against a `BuildingInstance.kind === 'capital'` already
decrements its `health`. EndTurn already checks units-eliminated. This
item wires the second win path: at EndTurn cleanup, if any seat's
capital has `health <= 0`, set `phase = 'ended'`, `winner = opposing seat`.

**Acceptance:**

- Both win paths coexist (units-eliminated wins iff capital still has
  HP; capital-zero wins iff opponent still has units). When both fire
  simultaneously, units-eliminated takes precedence — pin in test.
- 4-player corner case: if seat 3's capital hits 0 in a 4-player game,
  game does NOT end (still two other capitals + units alive). Pin.
- Test fixture lives in `packages/rules/src/__tests__/winCondition.test.ts`
  alongside the existing #55 tests.

**Out of scope:** siege state, multiple-capitals-per-player. Capital
`siegeState` is part of the deferred RFC (item 5).

---

### 3. Web: Interactive board — Deploy / Move / Attack / Scout pickers

**Owner:** Lando. **Deps:** items 1, 2. **Size:** ~2 days (biggest
item — splittable if it slips).

The current `Board.tsx` is render-only. PlayCard works from the hand
strip (`#37` closed). The remaining four actions need a unified
selection model on the board itself.

**Interaction pattern (single re-used component):**

1. Empty board — click a unit you own → it becomes the "selected actor".
2. Selected actor → board overlays legal targets:
   - `Move`: reachable empty squares within range, terrain-respecting.
   - `Attack`: enemy units/capitals within melee or ranged range
     (UI offers a mode toggle when both are legal).
   - `Scout`: adjacent face-down tiles.
3. Click a target → `dispatchAction(...)` (Lobby's existing helper).
4. Selecting a card in hand instead → `Deploy` mode: highlights empty
   squares adjacent to your Capital, click to commit.
5. Right-click / Escape clears selection.

**Acceptance:**

- All four actions reachable end-to-end without dev-tools.
- Action errors from the worker (`illegal_move`, `out_of_range`, etc.)
  render as a transient toast above the board.
- `data-testid` hooks on every interactive element for Playwright
  (item 6) — `cell-x-y`, `unit-{instanceId}`, `target-legal`, etc.
- Web tests in `apps/web/src/__tests__/Board.interactive.test.tsx`
  covering the four selection state machines with mocked API.

**Note:** This issue is intentionally bundled, mirroring how `#35`
bundled the entire static-board render. If it doesn't fit in 2 days,
split along action lines (Deploy / Move / Attack / Scout) and absorb
the slip into MVP-5.

---

### 4. Web: HUD polish — Capital HP, resource bank, turn indicator, winner banner

**Owner:** Sabine (tokens) + Lando (component). **Deps:** items 2, 3.
**Size:** ~1 day.

The board renders terrain + units today but nothing else. MVP-4 needs
the bare minimum HUD to make a game legible:

- Capital HP gauge on each Capital marker (text + colored bar).
- Per-player resource bank read-out at the bottom (food/wood/gold/etc.
  counts — read-only; cost-paying lands in MVP-5).
- Active-turn indicator (which seat is up, which phase, whose turn it
  is to react in 4-player).
- Winner banner when `state.phase === 'ended'` — full-screen overlay
  with "You won" / "You lost" / "Seat N wins" depending on `state.winner`
  and the viewer's seat.

**Acceptance:**

- All four elements visible in the same render pass without scrolling
  on a 1280×720 viewport.
- Sabine owns palette + sizing; Lando owns component wiring.
- A test selects the "You lost" banner after item 2's win condition
  fires.

---

### 5. Schema: RFC — Capital tile membership + per-player units[]

**Owner:** Wedge drafts; Artoo + Cassian review. **Deps:** none.
**Size:** RFC only (~½ day) — no implementation in MVP-4.
**Discharges debt** flagged in Artoo's `capital-init` decision (open
`@needs-rfc` from MVP-3).

The current model has two shapes that need a coherent design before
MVP-5 builds card effects on them:

- `BuildingInstance` (capital) currently lives at a `coord` with no
  explicit `tileId` link. Siege effects ("when defender is on tile X")
  will need it.
- `state.units` is flat with `owner: Seat`. Card effects targeting
  "all your units" or "your fastest unit" iterate-and-filter every
  time. Some agents prefer `state.players[seat].units: UnitInstance[]`.
  Both work; we should pick one before handlers depend on the shape.

**Acceptance:**

- RFC document at `.squad/decisions/inbox/wedge-capital-units-shape.md`.
- Proposes ONE shape with rationale (locality vs. global-query trade).
- Includes a `siegeState` field for capitals
  (`'open' | 'sieged' | 'fallen'`?) consumed by future card effects.
- Artoo + Cassian sign off in PR comments; merge into `decisions.md`.

**Out of scope:** the actual migration. That ships first thing in MVP-5
when card-effect handlers need it.

---

### 6. E2E: two-browser playable handoff to win condition

**Owner:** Cassian. **Deps:** items 1, 2, 3, 4. **Size:** ~½ day.

Replaces / extends the existing `two-browser-handoff.spec.ts` with a
full game arc. Two browsers (host + joiner) walk through:

1. Create game, share code.
2. Host deploys a unit adjacent to their Capital.
3. EndTurn.
4. Joiner deploys, moves, attacks.
5. Host repeats until Capital HP reaches 0.
6. Both browsers see the winner banner (host: "You lost", joiner:
   "You won").

**Acceptance:**

- Test runs in CI on `apps/e2e` against a `wrangler dev`-style worker.
- Total runtime ≤ 30 s.
- No hard waits beyond explicit polling for the 2 s state refresh.

---

### 7. Rules: integration test coverage for combined Move + Attack + Win

**Owner:** Cassian. **Deps:** items 1, 2 (can run in parallel with 3-4).
**Size:** ~½ day.

Item 1 and item 2 ship with their own unit tests. This item adds the
integration scenarios that the unit tests alone can't pin:

- Deploy → Move → Attack → kill last enemy unit → win at EndTurn.
- Deploy → Move → Attack capital → reduce HP → next turn Move closer →
  Attack capital → HP zero → win at EndTurn.
- Resupply hand cap edge case at the end of a winning turn (do we
  still draw? — yes; pin).
- Two-front 4-player partial: seat 3 wipes seat 1's Capital but seat 2
  is still alive. Game does NOT end. Pin.

**Acceptance:**

- Tests live in `packages/rules/src/__tests__/playable-arc.test.ts`.
- All scenarios pass on the same `applyAction` call chain a real client
  would issue (no internal shortcuts).

---

## What's deliberately NOT in MVP-4

- **Card effect handlers per kind/per civ.** Tactics, Technologies,
  Events, Upgrades, Reactions all stay as data with `effect: unknown`.
  The handler vocabulary lock is its own MVP-5-opening RFC, NOT bundled
  with board UI under time pressure.
- **Move pattern (short vs long).** Defer with naval units to MVP-5.
- **Resource cost payment.** Resources display read-only in HUD; you
  still deploy and attack for free in MVP-4. Cost-paying needs cost
  shape decisions that overlap the handler vocab lock.
- **Reaction-window timing.** Reaction cards stay schema-shaped but
  un-wired.
- **Recruit, Resupply, UnitAbility action handlers.** Defer.
- **`_needsConfirmation` OCR backfill** on Byzantines + StartingTiles.
  Gameplay-orthogonal; let it ride until card behaviors need exact
  costs.
- **Capital tile/units[] migration.** The RFC (item 5) lands; the
  implementation lands in MVP-5.

---

## Risk callouts

- **Item 3 is the bulky one.** If it slips, split along action lines
  rather than letting it eat MVP-4's deadline. Move+Deploy UI is the
  minimum viable cut; Attack and Scout UI can defer to MVP-4.5 or be
  CLI-only for the E2E.
- **Item 2 + item 7 must agree on win precedence** when both paths fire
  the same turn. Artoo writes the rule; Cassian pins it. They should
  coordinate in the inbox before either PR opens.
- **Item 5 is RFC-only on purpose.** If review comments demand
  implementation in MVP-4, push back: the migration is non-trivial and
  blocks no other MVP-4 item. Keep it RFC.

---

## Suggested issue labels (when filed)

- All items: `mvp-4`
- Items 1, 2, 7: `area:rules`
- Items 3, 4: `area:web`
- Item 5: `area:schema`, `rfc`
- Item 6: `area:e2e`
- Owner labels per `team.md` (`squad:artoo`, `squad:lando`, etc.)
