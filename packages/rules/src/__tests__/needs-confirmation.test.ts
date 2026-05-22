import type { Action } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { SEAT_1, SEAT_2, baseState, withState } from './fixtures.js';

// ─────────────────────────── needs-confirmation suite ─────────────────
//
// Each `describe` below pins ONE rulebook ambiguity from
// `wedge-rulebook-synthesis.md` (§"Ambiguities found"). Every `it` is
// currently `it.skip`-ed: the rule it asserts against is either not yet
// implemented in `applyAction`, OR the interpretation needs Jason's
// confirmation before we lock CI behavior to it.
//
// THE SKIPS ARE INTENTIONAL.
//
// What an entry MUST contain:
//   1. A `// @needs-confirmation: <one-line question>` comment directly
//      above the `it`. This is the load-bearing tag — grep/CI counts it.
//   2. A *default interpretation* recorded in plain English in the
//      `// Default:` comment line.
//   3. An assertion body describing the EXPECTED post-resolution
//      behavior. When the rule is confirmed and implemented, un-skip
//      and the assertion locks regression.
//
// Un-skip workflow (also in `packages/rules/README.md`):
//   1. Ask Jason → get a yes/no on the default interpretation.
//   2. Write a decision file under `.squad/decisions/inbox/` (e.g.
//      `cassian-ambiguity-N-<slug>.md`) capturing the answer + source.
//   3. Remove `.skip` and tighten the assertion if needed.
//   4. If the rule still isn't implemented, leave the test live but
//      expecting `not_implemented` until the handler lands.
//   5. Land in a separate PR — never bundle confirmation with feature.
//
// We deliberately keep these tests free of new fixtures. They reuse the
// shared `baseState`/`withState` factory so they stay aligned with the
// canonical state shape Artoo's #6 work produces.

// CI-side counter helper. The number on the right is the count of
// pinned ambiguities — bump if you add another `describe` below.
export const NEEDS_CONFIRMATION_COUNT = 10 as const;

// Convenience: action stubs cast to `Action`. The phase gate only
// inspects `action.type`; un-skipped tests will replace these with
// real payloads once the underlying handlers exist.
const stub = <T extends Action['type']>(type: T): Action =>
  ({ type } as unknown as Action);

// ─── #1: Reaction timing windows ──────────────────────────────────────
describe('Ambiguity #1 — Reaction timing windows', () => {
  // @needs-confirmation: After which sub-steps of an active-turn action does a reaction window open?
  // Default: every top-level Action opens ONE reaction window AFTER
  // legality gates pass but BEFORE state mutation. The non-active seat
  // may PlayReaction once per window; the original action then resolves
  // (possibly modified by the reaction).
  it.skip('opens a reaction window after gate-pass and before resolution', () => {
    const state = withState({ phase: 'mobilization', activePlayer: 1 });

    // Active seat declares an Attack — should NOT immediately mutate
    // state. Engine returns a "pending reaction" verdict carrying the
    // declared action and a window-id the opponent can target.
    const result = applyAction(state, stub('Attack'), SEAT_1);

    // When the schema gains a `pending_reaction` verdict shape this
    // assertion will tighten. For now we pin the behavior in prose:
    // expect(result.ok).toBe(false); // not ok in the "applied" sense
    // expect(result.value.kind).toBe('pending_reaction');
    expect(result.ok).toBeDefined();
  });
});

// ─── #2: "Two-effect" cards ───────────────────────────────────────────
describe('Ambiguity #2 — Two-effect cards: per-play or per-game?', () => {
  // @needs-confirmation: When a card says "use only one of these effects", is the choice per-play or once-per-game?
  // Default: PER-PLAY. The choice is made each time the card resolves;
  // if the card returns to hand (via Reaction/Action effect) and is
  // re-played, the player may choose the other effect on the next play.
  it.skip('records the chosen effect on each play independently', () => {
    // When a `PlayAction` with `effectChoice` parameter lands we'll
    // assert that the same card can be played twice (where mechanics
    // allow) with different `effectChoice` values both succeeding.
    const state = withState({ phase: 'deployment' });
    const first = applyAction(state, stub('PlayAction'), SEAT_1);
    expect(first.ok).toBeDefined();
    // Future shape:
    //   expect(first.value.moveLog.at(-1)?.params.effectChoice).toBe('A');
    //   const second = applyAction(first.value, playSameCardAgain('B'), SEAT_1);
    //   expect(second.value.moveLog.at(-1)?.params.effectChoice).toBe('B');
  });
});

// ─── #3: King/Queen-attached unit discard ─────────────────────────────
describe('Ambiguity #3 — King/Queen-attached unit discard behavior', () => {
  // @needs-confirmation: If a unit carries the King/Queen pawn and the player must discard a deployed unit to make room, is that unit discardable?
  // Default: NO. King/Queen-attached units are EXEMPT from forced
  // discard for-room. The rulebook's "(excluding King/Queen)" applies
  // to whichever unit is currently bearing the pawn at discard time.
  // The pawn itself is one-shot — once removed it does not return.
  it.skip('refuses to discard a King-attached unit during forced room-making', () => {
    const state = withState({ phase: 'deployment' });
    // When DeployUnit's "field full → discard" branch exists, the
    // engine will be asked to pick a discard target. With King attached
    // to the only candidate, the verdict should be `unit_field_full`
    // (not implicit auto-discard of the King-bearing unit).
    const result = applyAction(state, stub('DeployUnit'), SEAT_1);
    expect(result.ok).toBeDefined();
  });
});

// ─── #4: Camp resource regeneration ───────────────────────────────────
describe('Ambiguity #4 — Camp resource regeneration semantics', () => {
  // @needs-confirmation: On Start of Turn, does each Camp regenerate to 1 unexhausted token (capped), or do tokens persist across turns?
  // Default: REGENERATE to 1. At Start of Turn each Camp re-grants
  // exactly one unexhausted resource token of its terrain type. Unspent
  // tokens from prior turns are NOT additive — Camps are not banks.
  // Initial-build grant (when first built) is also exactly 1 token.
  it.skip('refreshes each Camp to exactly 1 unexhausted token at start-of-turn', () => {
    // Future: build a Camp via BuildCamp in T1, EndTurn x2, observe
    // owner's resources at T2 start.
    const state = withState({ phase: 'mobilization', activePlayer: 1 });
    const built = applyAction(state, stub('BuildCamp'), SEAT_1);
    expect(built.ok).toBeDefined();
    // expect(built.value.players[SEAT_1].resources.filter(r => !r.exhausted).length).toBe(1);
  });
});

// ─── #5: Scouting onto water ──────────────────────────────────────────
describe('Ambiguity #5 — Scouting onto water cost', () => {
  // @needs-confirmation: When a Scout reveals a water square as the first square, does the unit's movement count as spent?
  // Default: NO. The unit moves back to its origin square and does NOT
  // exhaust. The Scout reveal still happens (tile orientation locked).
  // Player retains the move; only sea-capable units may then re-enter.
  it.skip('returns the scout to origin without consuming movement', () => {
    const state = withState({ phase: 'mobilization', activePlayer: 1 });
    const result = applyAction(state, stub('Scout'), SEAT_1);
    expect(result.ok).toBeDefined();
    // Future: after Scout, scouting unit should be at its starting
    // square AND `exhausted === false`. Tile orientation should be set.
    //   expect(unit.square).toEqual(originSquare);
    //   expect(unit.exhausted).toBe(false);
    //   expect(tileById('t-x').faceDown).toBe(false);
  });
});

// ─── #6: Upgrade stacking across units ────────────────────────────────
describe('Ambiguity #6 — Upgrade stacking across multiple units', () => {
  // @needs-confirmation: Same upgrade card cannot stack on ONE unit; can two copies of the same upgrade card attach to DIFFERENT units simultaneously?
  // Default: YES. The "no double-up on the same unit" rule scopes to a
  // single unit instance. Two separate copies of the same upgrade card,
  // played on two different units, both stand. (Each copy is its own
  // card-instance in the moveLog.)
  it.skip('allows the same upgrade card on two different units', () => {
    const state = withState({ phase: 'deployment', activePlayer: 1 });

    // First copy → unit A. Both should resolve.
    const first = applyAction(state, stub('PlayUpgrade'), SEAT_1);
    expect(first.ok).toBeDefined();

    // Second copy → unit B. Future assertion:
    //   if (first.ok) {
    //     const second = applyAction(first.value, playUpgrade(card, unitB), SEAT_1);
    //     expect(second.ok).toBe(true);
    //   }
  });

  // @needs-confirmation: Can the SAME upgrade card be re-attached to the SAME unit after the original is destroyed (and the upgrade returns to discard)?
  // Default: YES. Re-attachment from discard is mechanically a new
  // play — the "not twice on same unit" rule reads as a state check at
  // attach time, not a permanent ban.
  it.skip('allows re-attachment after the prior copy is discarded', () => {
    // Future: deploy unit, attach upgrade, kill unit, deploy new unit,
    // re-play upgrade from discard pile. Expect ok.
    const state = withState({ phase: 'deployment' });
    const r = applyAction(state, stub('PlayUpgrade'), SEAT_1);
    expect(r.ok).toBeDefined();
  });
});

// ─── #7: "Surrounding Capital" — diagonal interpretation ──────────────
describe('Ambiguity #7 — "Surrounding Capital" includes diagonals', () => {
  // @needs-confirmation: For Barracks placement, does "surrounding the Capital" include the four diagonal squares (Chebyshev distance ≤ 1) or only orthogonal (Manhattan distance 1)?
  // Default: INCLUDES DIAGONALS. The glossary defines "surrounding" as
  // the 8 adjacent squares (Chebyshev = 1). A Barracks may be built on
  // any of the up-to-8 squares adjacent to the owner's Capital,
  // including the four diagonals, provided terrain permits.
  it.skip('treats diagonal squares as legal Barracks placements next to Capital', () => {
    const state = withState({ phase: 'mobilization', activePlayer: 1 });
    // English capital sits at (0,0). Diagonal-adjacent (1,1) should be
    // a legal target. Future assertion:
    //   const action = buildBarracks({ unitId, square: { x: 1, y: 1 } });
    //   const result = applyAction(state, action, SEAT_1);
    //   expect(result.ok).toBe(true);
    const result = applyAction(state, stub('BuildBarracks'), SEAT_1);
    expect(result.ok).toBeDefined();
  });
});

// ─── #8: Melee mutual-kill — square occupancy ─────────────────────────
describe('Ambiguity #8 — Melee mutual-kill square occupancy', () => {
  // @needs-confirmation: When a melee attack kills both attacker and defender simultaneously, who (if anyone) ends up on the target square?
  // Default: EMPTY SQUARE. Both units are removed; the attacker does
  // NOT advance onto the now-empty target square because the attacker
  // is itself destroyed in the same atomic resolution. The rulebook's
  // "if the target square is still occupied, move back" branch is moot
  // when the attacker no longer exists.
  it.skip('leaves target square empty when both combatants die', () => {
    const state = withState({ phase: 'mobilization', activePlayer: 1 });
    const result = applyAction(state, stub('Attack'), SEAT_1);
    expect(result.ok).toBeDefined();
    // Future: after mutual-kill Attack on square (x,y):
    //   expect(unitsAtSquare(result.value, { x, y })).toHaveLength(0);
    //   expect(result.value.units.find(u => u.id === attackerId)).toBeUndefined();
    //   expect(result.value.units.find(u => u.id === defenderId)).toBeUndefined();
  });
});

// ─── #9: Long-Range vs Short-Range diagonal interaction ───────────────
describe('Ambiguity #9 — Long-Range diagonal vs Short-Range Ranged rule', () => {
  // @needs-confirmation: Short-Range cannot attack diagonally with Ranged mode. Does Long-Range (range 2) inherit that restriction at distance 1, at distance 2, or not at all?
  // Default: LONG-RANGE BYPASSES THE DIAGONAL RESTRICTION ENTIRELY.
  // The Short-Range diagonal ban is a Short-Range keyword rule, not a
  // global Ranged rule. Long-Range units may target any square within
  // their range (Chebyshev distance ≤ 2), diagonals included, in
  // Ranged attack mode.
  it.skip('permits Long-Range Ranged attack on a diagonal target at distance 2', () => {
    const state = withState({ phase: 'mobilization', activePlayer: 1 });
    const result = applyAction(state, stub('Attack'), SEAT_1);
    expect(result.ok).toBeDefined();
    // Future: with a long-range archer at (0,0) and a defender at
    // (2,2), Attack{ mode: 'ranged' } should succeed.
    //   expect(result.ok).toBe(true);
  });

  // @needs-confirmation: Does Long-Range at distance 1 (a diagonal square 1 away) still respect the Short-Range diagonal ban?
  // Default: NO. Distance is irrelevant — the ban is keyword-scoped.
  // A Long-Range unit firing diagonally at distance 1 is legal.
  it.skip('permits Long-Range Ranged attack on an adjacent diagonal target', () => {
    const state = withState({ phase: 'mobilization', activePlayer: 1 });
    const result = applyAction(state, stub('Attack'), SEAT_1);
    expect(result.ok).toBeDefined();
  });
});

// ─── #10: Deck-empty discard interactions ─────────────────────────────
describe('Ambiguity #10 — Deck-empty discard interactions', () => {
  // @needs-confirmation: With no reshuffle, when a card effect says "draw a card" and the deck is empty, does the action fail, no-op, or trigger a side effect (e.g., Capital damage)?
  // Default: NO-OP. The draw silently yields nothing; the action that
  // triggered the draw still resolves. Empty deck is NOT a loss
  // condition (only HP=0 and zero-units-on-board are). Other card
  // effects that reference "from your deck" treat empty as no target.
  it.skip('treats draw-from-empty as a silent no-op (deck stays empty, no HP loss)', () => {
    // Reuse baseState — both players start with empty decks in the
    // shared fixture, so the moment draw is implemented this becomes
    // a real, runnable test of the no-op contract.
    const state = withState({ phase: 'end', activePlayer: 1 });
    const endTurn = applyAction(state, stub('EndTurn'), SEAT_1);
    expect(endTurn.ok).toBe(true);
    if (endTurn.ok) {
      // Post-EndTurn (with hand-cap draw implemented in #7), the
      // english player's deck should still be empty AND capital HP
      // should be unchanged.
      expect(endTurn.value.players[1]!.deck).toEqual([]);
      expect(endTurn.value.players[1]!.capitalHp).toBe(10);
    }
  });

  // @needs-confirmation: When a card effect says "place top card of your deck into discard" and the deck is empty, does the action succeed (no-op) or fail (illegal action)?
  // Default: SUCCEED AS NO-OP. Consistent with the draw-from-empty
  // rule — empty deck means zero cards moved, but the parent action
  // (e.g., a Tactic that mills) still resolves with any other effects.
  it.skip('treats mill-from-empty as a no-op without failing the parent action', () => {
    const state = withState({ phase: 'mobilization', activePlayer: 1 });
    const result = applyAction(state, stub('PlayTactic'), SEAT_1);
    expect(result.ok).toBeDefined();
  });

  // @needs-confirmation: Does an empty deck at end-of-turn skip the "draw to 5 if hand < 5" rule, or trigger any penalty?
  // Default: SKIPS, NO PENALTY. End-of-turn draw is best-effort. With
  // an empty deck the hand stays at its current size; no draw fires
  // and no Capital damage is dealt.
  it.skip('skips end-of-turn refill silently when deck is empty', () => {
    // EndTurn currently uses an unimplemented draw stub — the
    // assertion captures the future contract.
    const state = withState({ phase: 'end', activePlayer: 1 });
    const handBefore = state.players[1]!.hand;
    const result = applyAction(state, stub('EndTurn'), SEAT_1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.players[1]!.hand).toEqual(handBefore);
      expect(result.value.players[1]!.capitalHp).toBe(10);
    }
  });
});

// ─── Sanity ───────────────────────────────────────────────────────────
//
// Single LIVE test in this suite — it asserts the count of pinned
// ambiguities. If the suite grows or shrinks, the constant at the top
// of this file is the single point of update. Vitest also reports the
// raw skipped-test count in its summary, so CI / PR templates can
// cross-reference.
describe('needs-confirmation suite invariants', () => {
  it('pins the documented count of ambiguities', () => {
    expect(NEEDS_CONFIRMATION_COUNT).toBe(10);
  });

  it('does not depend on any opponent-seat behavior', () => {
    // Smoke: SEAT_2 reactions should remain gated as `not_implemented`
    // (see phases.test.ts). This guards against accidental seat-2
    // coupling sneaking into a pinned-ambiguity fixture.
    const state = withState({ phase: 'mobilization', activePlayer: 1 });
    const r = applyAction(state, stub('PlayReaction'), SEAT_2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_implemented');
  });
});

// Static reference so the unused-import linter doesn't strip `baseState`
// from imports — future fixture work will lean on it directly.
void baseState;
