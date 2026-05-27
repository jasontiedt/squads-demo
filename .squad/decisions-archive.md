# Squad Decisions — Archive

Older decision entries archived from `decisions.md` to keep the active ledger lean.
Newest archive batch on top. Each batch records the archive date and the cutoff used.

---

## Archived 2026-05-27 (cutoff: entries older than 7 days)

### MVP-5 closeout — 2025-11-21

### 2025-11-21: Effect DSL locked — typed verbs for Action and Tactic cards

**By:** Wedge (Lead/Architect) — via Scribe merge — PR #90, closes #83
**What:** Replaced `effect: z.unknown()` on Action and Tactic card kinds with a strict Zod discriminated union of five verbs: `draw`, `damage`, `heal-capital`, `gain-temporary-resource`, `buff-unit-stat`. Locked the `Target` taxonomy: `'self-capital' | 'opponent-capital' | { kind: 'unit', unitId } | { kind: 'units-by-class', classFilter, ownership }`. Technology, Upgrade, Reaction, and Event keep `effect: z.unknown()` for MVP-5 — their handlers remain `not_implemented`. The Effect DSL lives in `packages/schema/src/effects.ts` and is imported by `cards.ts`. Schema-breaking change accepted; no production KV state existed yet.
**Why:** Every other MVP-5 slice depended on a stable, narrow vocabulary. `effect: z.unknown()` had been the implicit blocker since MVP-1 — it left `PlayAction`/`PlayTactic` as stubs, forced Sabine to encode designer intent as prose, and blocked Lando's PlayCard UI. Locking now (with zero production blast radius) was a free move.
**Source:** `.squad/decisions/inbox/wedge-mvp5-scope.md` (merged into archive below).

### 2025-11-21: MVP-5 scope — "Cards Do Things"

**By:** Wedge (Lead/Architect) — via Scribe merge — closes #83-#89
**What:** MVP-5 shipped its stop condition: Player A plays an Action card (cost paid, hand → discard, `draw 2` resolves) and a Tactic card (own unit gains a temporary stat buff that clears at EndTurn). Worker re-validates both; opponent observes state via polling. Two card kinds in scope (Action, Tactic); Technology, Upgrade, Reaction, Event deferred to MVP-6. Seven slices shipped across six PRs: S1 Effect DSL (#90), S2 payCost (#91), S6 seat-scoped hand unredact (#92), S3 dispatcher + PlayAction (#93), S4 PlayTactic + EndTurn buff cleanup (#94), S5 catalog typed effects (#95), S7 integration arc (#96).
**Why:** Theme was "smallest move that makes a card affect game state beyond the discard+draw stub." Two card kinds covered the stop condition without forcing the dispatcher to anticipate Reactions/Events/passive Tech.
**Source:** `.squad/decisions/inbox/wedge-mvp5-scope.md` (merged).

### 2025-11-21: payCost handler — pay-first, then resolve

**By:** Artoo (Backend) — PR #91, closes #84
**What:** `payCost(state, seat, cost): Result<GameState>` in `packages/rules/src/payCost.ts`. Exhausts unexhausted resource tokens matching the cost's resource kinds; consumes `temporaryResources` first (cheaper), then main resources, with `wild` falling back across any kind. Returns `err('insufficient_resources')` if the cost cannot be paid. Pure and deterministic. Ordering pinned in test: if cost succeeds but the downstream effect fails, the rules engine returns the pre-payment state (`Result.err` carries no partial mutation).
**Why:** Every non-unit handler that follows needs cost-payment as a primitive. Pulling it into its own slice let it land in parallel with the S1 RFC.
**Source:** `.squad/decisions/inbox/wedge-mvp5-scope.md` (S2).

### 2025-11-21: Seat-scoped hand unredact via `?seat=` query param

**By:** Artoo (Backend) — PR #92, closes #88
**What:** `GET /games/:id?seat=X` on the Worker now returns the unredacted hand for the requesting seat (validated against the seat's player token in the `Authorization` header); opponents' hands stay redacted. Card images and IDs are visible only to the owning seat. Miniflare integration test covers happy path + wrong-token rejection.
**Why:** Unblocks the two-browser stop condition — without it the human cannot see their own hand to choose a card. Carry-over from MVP-4 (#37). Independent of the Effect DSL work.
**Source:** `.squad/decisions/inbox/wedge-mvp5-scope.md` (S6).

### 2025-11-21: Effect dispatcher + PlayAction — generic PlayCard deleted

**By:** Artoo (Backend) — PR #93, closes #85
**What:** New `packages/rules/src/effects/` module with `dispatchEffect(state, effect, ctx): Result<GameState>` pattern-matching on `effect.kind`. Per-verb handlers: `effectDraw`, `effectDamage`, `effectHealCapital`, `effectGainTempResource`, `effectBuffUnitStat`. `ctx` carries `actorSeat`, `cardId`, and optional `chosenTarget` for picker-driven effects. `PlayAction` wired in `applyAction.ts`: lookup `card.effect` → `payCost` → move hand → discard → `dispatchEffect`. The MVP-2 generic `playCard.ts` handler and the `PlayCard` action variant are DELETED — no vestigial second path. **Process note:** Artoo's spawn experienced a silent-success — files were staged but commit/push/PR did not happen. Coordinator recovered, landed build fixes, and shipped the PR. Lesson recorded in Artoo's history.
**Why:** This is the central new machine. Once it existed, S4 (PlayTactic) became a thin wrapper. Removing the generic stub closes the dual-path risk before card UI work begins in MVP-6.
**Source:** `.squad/decisions/inbox/wedge-mvp5-scope.md` (S3).

### 2025-11-21: PlayTactic handler + temporary buffs cleared at EndTurn

**By:** Artoo (Backend) — PR #94, closes #86
**What:** `PlayTactic` wired in `applyAction.ts`, reusing the S3 dispatcher. Phase gate validates the card's `playableIn` includes `state.phase` (Tactic legal in Mobilization + Deployment). Temporary buffs live on `UnitInstance` as an optional `temporaryBuffs?: Array<{stat, delta, expires: 'end-of-turn'}>` field (NOT separate buff entities — keeps state diffs small for polling). Cleanup runs in `drawAndDiscardCleanup` on EndTurn. Cross-seat duration semantics ("end of turn" when targeting opponent unit) flagged as `needs-confirmation` and deferred to MVP-6 — MVP-5 cards target own units only.
**Why:** Tactics are the second card kind in the stop condition. They exercise the time-bound effect path that Reactions/Events will later generalize.
**Source:** `.squad/decisions/inbox/wedge-mvp5-scope.md` (S4).

### 2025-11-21: English catalog backfill — typed effects on Action + Tactic cards

**By:** Sabine (Catalog/Design) — PR #95, closes #87
**What:** Replaced prose `PLACEHOLDER:` strings on the 4 non-unit English cards (and 1-2 stop-condition additions) with typed `Effect` payloads conforming to the S1 union. `classFilter` on `Target` (locked in S1 as `{ kind: 'units-by-class', classFilter, ownership }`) covers "Shield Wall" (infantry) and "Longbow Mastery" (archers) without re-theming. Byzantines catalog stays stub. Cards that don't fit MVP-5's five verbs keep prose placeholders, schema permits this only for Technology/Upgrade/Reaction/Event.
**Why:** Without typed effect data, S3/S4 had nothing to dispatch. Also forced a sanity check on the locked vocab — `classFilter` survived contact with real card text.
**Source:** `.squad/decisions/inbox/wedge-mvp5-scope.md` (S5).

### 2025-11-21: MVP-5 acceptance arc — Miniflare integration test

**By:** Cassian (Tester/QA) — PR #96, closes #89
**What:** Two Miniflare integration tests in `apps/worker/test/`: `integration-mvp5-action-arc.test.ts` drives seed → first turn → PlayAction (draw 2) → assert hand-size delta + moveLog entry. `integration-mvp5-tactic-buff.test.ts` drives PlayTactic (buff own unit) → EndTurn → assert `temporaryBuffs` cleared on the targeted unit. Both green at merge.
**Why:** Executable definition of "MVP-5 done."
**Open:** Playwright two-browser E2E was NOT shipped this MVP. The seeded deck shuffles non-deterministically per game (no admin seed endpoint exists), making it impossible to script "play the Action card that draws 2" reliably from the e2e harness. MVP-6 issue to file: add an admin seed endpoint that pins deck order for test runs.
**Source:** `.squad/decisions/inbox/wedge-mvp5-scope.md` (S7).

### 2025-11-21: MVP-5 cross-cutting locks (carried into MVP-6)

**By:** Wedge (Lead/Architect) — via Scribe merge — cross-cutting from `wedge-mvp5-scope.md`
**What:** Six rules locked for MVP-5 carry forward unchanged:
1. **Effect DSL is closed at 5 verbs.** Adding `attach-keyword`, `class-wide-passive`, `trigger-on-event` waits for MVP-6 (dispatcher pattern is now proven, adding verbs is mechanical).
2. **Targets are picker-driven, not declarative.** Client includes `unitId` in the action payload when the effect targets a unit — consistent with Move/Attack.
3. **Temporary buffs live on `UnitInstance.temporaryBuffs`,** not as separate buff entities. Cleared by `drawAndDiscardCleanup` on EndTurn.
4. **Cost-payment ordering: pay-first, then resolve.** Cost failure → no state change. Effect failure after cost → engine returns pre-payment state (caller discards on err).
5. **`PlayAction`/`PlayTactic` reuse existing schema slots** in the `Action` union — no new variants.
6. **The generic `PlayCard` handler and action variant are deleted** (not kept as a parallel path).
**Why:** These are the durable architectural decisions from MVP-5 — they survive MVP-6 unless explicitly revisited.

### 2025-11-21: Reactions / Events / Technology / Upgrade — deferred to MVP-6

**By:** Wedge (Lead/Architect) — via Scribe merge
**What:** No `PlayReaction`, `PlayEvent`, `PlayTechnology`, or `PlayUpgrade` handler shipped in MVP-5. These kinds keep `effect: z.unknown()` and their `applyAction.ts` handlers remain `not_implemented`. Brady confirmed deferral during MVP-5 scoping.
**Why:** Reactions add ~3 slices (trigger taxonomy, opponent-window state, dispatcher branch). Bundling them with the dispatcher would have stretched MVP-5 past 10 slices.
**MVP-6 candidate scope:** Reactions (trigger taxonomy + opponent window), Events (≤3 active limit + persistent effects), Technology (class-wide passive buffs), Upgrade (attach-to-unit keyword effects), card-play UI for non-unit cards (Lando), admin seed endpoint for deterministic e2e (carry-over from PR #96 deferral).
