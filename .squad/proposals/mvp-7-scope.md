# MVP-7 scope proposal — Echoes of Emperors

**Author:** Wedge (Lead / Architect)
**Date:** 2026-05-28
**HEAD:** `b3d0714` on `main`
**Status:** Draft for Jason's review — issues #112 and #113 already filed as inputs; new issues NOT yet filed.

---

## TL;DR

MVP-7 is **"Economy & Buildings"** — close the
`BuildCamp → Start-of-Turn regen → pay cost → Deploy → Attack` loop
end-to-end so the reaction-arc e2e Cassian scaffolded in MVP-6
(`apps/e2e/tests/mvp6-reaction-arc.spec.ts`, currently `test.skip`)
can run as REAL gameplay, no admin-seed shortcut, and stay green in CI.

The hypothesis in the spawn prompt is **accepted**. Confirmation: the
MVP-6 blocker diagnosed by Cassian
(`cassian-mvp6-e2e-blocker-resolved.md`) is unambiguous — `BuildCamp`
returns `not_implemented`, `player.resources` starts `[]`, so the
deploy step of every demo today is unreachable through normal play.
The other plausible themes (civ-card system, Tactic/Tech effects,
multi-tile terrain) are all downstream of being able to play a turn
without an admin endpoint. Fix the loop first.

Scope cut vs the hypothesis: **RelocateBuilding, SwitchAttackMode,
UnitAbility, and DiscardEvent** stay `not_implemented`. They're listed
in `applyAction.ts:304` as stubs but none of them are on the path
between "deploy a unit" and "win a game." They wait.

**Stop condition for MVP-7 overall:** the reaction-arc e2e
(`mvp6-reaction-arc.spec.ts`) un-skipped and passing in CI without
admin-seed touching `resources` or `units` — i.e. the host issues
`BuildCamp` → ends turn → joiner ends turn → host's Camp regens a
token at Start of Turn → host pays the cost and `DeployUnit`s →
remaining beats (attack, reaction window, capital HP delta) run
through normally. Demoable: two browsers, no dev tools, real economy.

---

## Dependency graph (one line)

`[1 BuildCamp+regen] → [3 BuildBarracks] ∥ [4 Resupply] ∥ [5 RecruitDraw] ∥ [6 HUD-economy] → [7 E2E un-skip]   |   [2 admin-seed-extension] ∥ [1]`

(`∥` = parallel-safe. `→` = hard dep. `|` = independent track.)

---

## Items (7 GitHub-issue-shaped)

### 1. Rules: `BuildCamp` effect handler + Start-of-Turn token regen — **issue #112 (already filed)**

**Owner:** @copilot 🟢 (or Artoo if @copilot bounces). **Deps:** none.
**Size:** ~1 day. **Existing issue: #112.**

The keystone. `BuildCamp` currently hits the stub branch in
`applyAction.ts:304`. Without it `player.resources` stays `[]` for
the whole game (initialState seeds it empty) and no card cost is
ever payable through normal play. This is the root blocker for the
MVP-6 e2e.

**Acceptance:**

- `BuildCamp` is gated by `ACTION_PHASE_LEGALITY` to `mobilization`
  phase, actor's own turn.
- Pays the camp's resource cost from `player.resources` (reuse
  `exhaustForCost` from `deployUnit.ts` — same primitive, no copy).
- Places a new `CampInstance` in `state.buildings` on the chosen
  square. MVP-7: target square must be on a revealed (face-up) tile
  the actor controls or is adjacent to their capital. (Mirror the
  deploy-zone check from `deployUnit.ts` step 4b.)
- Adds a `ResourceToken` of the camp's `produces` kind to the owner's
  `resources` AT Start of Turn each subsequent turn — wired through
  the existing EndTurn/Start-of-Turn chain (same place `eventTick`
  hooks in).
- Un-skips the `@needs-confirmation` test in
  `packages/rules/src/__tests__/needs-confirmation.test.ts` (the
  ambiguity #4 entry the issue references).
- Tests in `packages/rules/src/__tests__/buildCamp.test.ts`: happy
  path, wrong-phase, wrong-seat, illegal square, cost short, Start-of-
  Turn regen adds exactly one token per camp per turn, regen respects
  owner.

**Out of scope:** Camp upgrade cards, multi-square camps, camp
destruction (Attack-vs-Camp stays the existing `not_implemented`
branch; lifted only if a story below forces it).

---

### 2. Rules+Worker: `admin-seed` extension — resources & units — **issue #113 (already filed)**

**Owner:** @copilot 🟢 (or Cassian). **Deps:** none. **Size:** ~½ day.
**Existing issue: #113.**

Test-only fast path. Lets future e2e tests bypass the economy loop
when the test isn't about the economy. Item 7 will deliberately NOT
use this for the reaction-arc — but other e2e specs (capital-zero arc,
playable arc, future card-effect arcs) should be able to skip the
3-turn warm-up.

**Acceptance:**

- `POST /admin/games/:code/seed` accepts new optional body fields:
  `resources?: ResourceToken[]`, `opponentResources?: ResourceToken[]`,
  `units?: SeededUnit[]`, `opponentUnits?: SeededUnit[]`.
  `SeededUnit = { cardId, square, exhausted?, damage? }` — id assigned
  deterministically by `deployUnit`-style positional rule.
- Existing body shape (`{ deckOrder, opponentDeckOrder, hand,
  opponentHand }`) stays backward-compatible. Documented in
  `cassian-mvp6-e2e-blocker-resolved.md` as the canonical shape — do
  NOT regress to the older `{ hostDeck, guestDeck }` naming.
- Admin secret gate unchanged: `X-Admin-Secret` header check.
- Worker test `apps/worker/test/admin-seed.test.ts` extended:
  happy-path seed of resources + units, version bumps, schema-valid
  output.
- Returns `{ ok: true, version }` per existing contract.

**Out of scope:** Seeding active events, reaction-window state,
or building damage. Add only when a future spec needs them.

---

### 3. Rules: `BuildBarracks` effect handler + adjacent-zone deploy

**Owner:** Artoo. **Deps:** item 1 (shares the building-placement
helper). **Size:** ~1 day.

Barracks is the second building kind and the only path to deploying
units anywhere besides the Capital square. The interactive board
(MVP-4 item 3) was wired to highlight legal deploy squares from
the Capital only because that's all `deployUnit.ts` allows; this
item widens the deploy-zone definition to include "squares adjacent
to an owned, undamaged Barracks."

**Acceptance:**

- `BuildBarracks` mirrors `BuildCamp`'s gates: `mobilization`, actor's
  turn, cost-payment via `exhaustForCost`, placement on a face-up tile
  the actor controls or adjacent to their capital.
- `deployUnit.ts` step 4 updated: a target square is legal if it is
  either the Capital square OR a square Chebyshev-adjacent to an owned
  `BarracksInstance` with `damage < hp`.
- The `Board.tsx` deploy-mode overlay re-uses the rules-side
  `legalDeploySquares(state, seat)` query (new export in
  `queries.ts`) — no parallel logic on the web side.
- Tests in `packages/rules/src/__tests__/buildBarracks.test.ts`
  (placement + cost + phase) AND
  `packages/rules/src/__tests__/deployUnit.test.ts` extension
  (deploy-near-barracks happy + barracks-on-cooldown rejected).

**Out of scope:** Barracks-spawned unit boosts, barracks-as-spawn-
point for Recruit cards. Defer.

---

### 4. Rules: `Resupply` effect handler

**Owner:** @copilot 🟢. **Deps:** none (does not need #1 — operates on
existing hand/deck). **Size:** ~½ day.

Per the rulebook synthesis (`decisions.md`): Resupply refreshes
exhausted resource tokens at a cost. Concrete handler shape:

**Acceptance:**

- `Resupply` is `mobilization`-phase, actor's turn.
- Flips all `exhausted: true` tokens on `player.resources` back to
  `exhausted: false`. (Tokens already on the player; this does NOT
  add new tokens — that's BuildCamp's regen path.)
- Discards the top N cards from the actor's deck as the cost (N from
  the card spec — pin to **1** for MVP-7, flag as `@needs-confirmation`
  in test until rulebook quote is OCR'd). If deck has < N, errors with
  `deck_too_thin` rather than partial-pay.
- Tests in `packages/rules/src/__tests__/resupply.test.ts`: refreshes
  exhausted tokens, leaves un-exhausted untouched, deck-thin error,
  phase/seat gates.

**Out of scope:** Free-resupply civ effects, "draw instead of discard"
variants. Standard Resupply only.

---

### 5. Rules: `RecruitDraw` effect handler

**Owner:** @copilot 🟢. **Deps:** none. **Size:** ~½ day.

Draws cards from the actor's deck into hand, respecting hand-cap 7
and the positional-discard overflow rule
(`cassian-seeded-prng-and-handcap.md`).

**Acceptance:**

- `RecruitDraw` is `mobilization`-phase, actor's turn.
- Draws `count` (from action payload, validated by schema) cards from
  the top of the actor's deck into hand.
- If hand would exceed cap 7, trailing cards are discarded positionally
  (re-use the existing helper from `draw.ts`).
- Empty-deck path: error `deck_empty` rather than reshuffle —
  consistent with the no-reshuffle decision in
  `decisions.md` (rulebook synthesis).
- Tests in `packages/rules/src/__tests__/recruitDraw.test.ts`: draws
  N cards, hand-cap overflow discards trailing, empty-deck rejects,
  phase/seat gates.

**Out of scope:** RecruitDraw-with-target-card-search (deck filtering).
Plain top-N draw only.

---

### 6. Web: HUD economy panel — Camp/Barracks markers, live resource bank, regen tick indicator

**Owner:** Sabine (tokens + visuals) + Lando (wiring). **Deps:**
items 1, 3. **Size:** ~1 day.

The MVP-4 HUD shows resource counts read-only and renders Capital
markers only. With buildings becoming playable in MVP-7, the player
needs to see them on the board AND see resources change as they're
spent and regenerated.

**Acceptance:**

- `CampInstance` and `BarracksInstance` render on `Board.tsx` at their
  `square` with distinct iconography (Sabine: tokens; Lando: SVG
  placement reusing the unit-render pattern).
- Resource bank in the bottom HUD updates live as actions dispatch —
  spent tokens render `exhausted` (greyed); regenerated tokens fade in
  on Start-of-Turn cleanup.
- `data-testid="building-{id}"` on every building marker, and
  `data-testid="resource-{kind}-{idx}"` with `data-exhausted="true|
  false"` on each bank token (Cassian needs both for item 7).
- Component tests in `apps/web/src/__tests__/Board.economy.test.tsx`:
  building markers render at the right squares, resource bank reflects
  state, exhausted tokens carry the data attribute.

**Out of scope:** Animated regen sparkles. Static fade is fine.

---

### 7. E2E: un-skip the MVP-6 reaction-arc spec — drive the loop through real play

**Owner:** Cassian. **Deps:** items 1, 3, 6 (item 2 explicitly NOT a
dep — that's the point). **Size:** ~½ day.

Removes `test.skip` from `apps/e2e/tests/mvp6-reaction-arc.spec.ts`
and rewrites the setup section so the test drives the economy loop
itself instead of asserting against a stubbed deploy. Proves the
demoable stop condition.

**Acceptance:**

- Test setup uses `admin-seed` ONLY for `deckOrder` /
  `opponentDeckOrder` / `hand` / `opponentHand` (deterministic card
  ordering for reaction-arc beats). Does NOT seed `resources` or
  `units`.
- Test flow:
  1. Create + join game via UI.
  2. Host plays `BuildCamp` (admin-seeded hand contains a Camp card).
  3. EndTurn → joiner EndTurn → host Start-of-Turn ticks → host now
     has 1 resource token.
  4. Host `DeployUnit` paid with the camp-regen'd token, on the
     Capital square (no Barracks needed for arc 1).
  5. EndTurn → joiner deploys (admin-seeded hand) → joiner attacks.
  6. Reaction window opens; host plays `byz-imperial-shield` reaction;
     capital-HP delta asserted.
- Total runtime ≤ 45 s (longer than MVP-4's arc because of the
  3-turn economy ramp; acceptable).
- Runs in CI on `apps/e2e` against `wrangler dev`. No hard waits
  beyond the existing 2 s poll interval.

**Out of scope:** Rewriting the playable-arc e2e
(`playable-arc.spec.ts`) to also drop admin-seed; that arc tests
combat reach, not economy. Item 2 is for those specs.

---

## What's deliberately NOT in MVP-7

- **`RelocateBuilding`, `SwitchAttackMode`, `UnitAbility`,
  `DiscardEvent` handlers.** All four are stubs at `applyAction.ts:304`.
  None of them gate the economy loop or the e2e stop condition. Defer
  to MVP-8.
- **Attack-vs-Camp / Attack-vs-Barracks.** `attack.ts` currently routes
  `Attack` with `targetBuildingId` to capitals only (per the MVP-4 lift
  in PR #79). Buildings remain indestructible in MVP-7. Add when a
  story or arc forces it.
- **Civ-deck Tactic / Technology / Upgrade / Event effects beyond the
  5 verbs locked in MVP-5.** New verbs wait for a real card that needs
  them.
- **OCR `_needsConfirmation` backfill on Byzantines + StartingTiles.**
  Still gameplay-orthogonal. Carry forward.
- **Resupply card-cost variant beyond fixed-1 discard.** Pin
  `@needs-confirmation`; revisit when OCR lands a real card text.

---

## Risk callouts

- **Item 1 is the keystone.** Items 3, 6, 7 all hard-depend on it.
  Sequence item 1 first; @copilot can take it because the spec is
  unambiguous (rulebook synthesis + existing `deployUnit.ts` pattern
  cover the shape). If @copilot bounces it, Artoo picks up — don't
  let it stall.
- **Item 7's 3-turn economy ramp is brittle if Start-of-Turn regen
  has off-by-one bugs.** Item 1's tests MUST pin "regen adds exactly
  one token per camp per Start of Turn, not on the turn the camp is
  built." If item 7 flakes in CI, suspect this first.
- **Item 3's deploy-zone widening could regress MVP-4's Capital-only
  deploy tests.** The existing `deployUnit.test.ts` must continue to
  pass unmodified; the widening is additive. Artoo: run
  `pnpm -r test` on the deploy + barracks combined PR before opening.
- **@copilot eligibility (🟢) calls.** Items 1, 2, 4, 5 are clear-spec
  card-effect / test-extension work — green per the capability profile
  in `team.md`. Items 3, 6, 7 require cross-file architectural choices
  (deploy-zone widening, HUD/rules coupling, e2e rewrite) — assign to
  squad agents.

---

## Suggested issue labels (when new issues are filed)

- All items: `mvp-7`
- Items 1, 3, 4, 5: `area:rules`
- Item 2: `area:worker`, `area:test-infra`
- Item 6: `area:web`
- Item 7: `area:e2e`
- Items 1, 4, 5: `squad:copilot` 🟢 (auto-assignable)
- Item 2: `squad:copilot` 🟢 OR `squad:cassian`
- Item 3: `squad:artoo`
- Item 6: `squad:sabine` + `squad:lando`
- Item 7: `squad:cassian`

(Issues #112 and #113 already filed — only items 3, 4, 5, 6, 7 need new issues. That's 5 new issues for MVP-7, matching the MVP-6 cadence.)
