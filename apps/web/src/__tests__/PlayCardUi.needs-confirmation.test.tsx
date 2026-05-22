/**
 * needs-confirmation — Cassian-style test pinning the target behaviour
 * for issue #37 (PlayCard UI). The whole describe is `.skip`'d until
 * Artoo confirms the worker contract change documented in
 * `.squad/decisions/inbox/lando-playcard-needs-worker-unredact.md`.
 *
 * BLOCKER (do NOT delete this file until resolved):
 *   The worker redacts every player's hand on every response, including
 *   the calling player's own hand (apps/worker/src/redact.ts +
 *   create-game.ts + join-game.ts + post-action.ts). The client never
 *   receives any `cardId`, so dispatching PlayCard from a click on a
 *   specific card is impossible end-to-end today.
 *
 * What this file pins (the *spec* once the worker exposes own-hand):
 *   1. Hand renders ONE clickable button per cardId, testid
 *      `card-{cardId}` (or wrapped li `card-{cardId}` with a nested
 *      `card-{cardId}-play-btn` — TBD with reviewers).
 *   2. Clicking a card calls `api.postAction` with
 *      `{ type: 'PlayCard', cardId, target: undefined }` and the
 *      current `state.version` as `expectedVersion`.
 *   3. Click is no-op when `state.activePlayer !== mySeat`.
 *   4. Click is no-op outside the `mobilization` and `deployment`
 *      phases.
 *   5. 409 retry mirrors EndPhase/EndTurn: refetch state, retry once
 *      with the fresh `version`. Second 409 surfaces via
 *      `data-testid="action-error"`.
 *   6. Server `InvalidActionError` (e.g. `card_not_in_hand`) surfaces
 *      via `data-testid="action-error"`.
 *
 * Cassian's note: the *intent* lives here; reviewers should change
 * these expectations BEFORE the implementation, not after.
 */
import { describe, it, expect } from 'vitest';

describe.skip('PlayCard UI — needs-confirmation (issue #37, blocked on worker)', () => {
  it('renders one clickable button per cardId with testid card-{cardId}', () => {
    expect(true).toBe(true);
  });

  it('click dispatches { type:"PlayCard", cardId, target:undefined } with current version', () => {
    expect(true).toBe(true);
  });

  it('cards are not clickable when it is not your turn', () => {
    expect(true).toBe(true);
  });

  it('cards are not clickable outside the mobilization / deployment phases', () => {
    expect(true).toBe(true);
  });

  it('retries postAction once after a 409 with the refetched version (mirrors EndPhase)', () => {
    expect(true).toBe(true);
  });

  it('surfaces card_not_in_hand and other engine errors via action-error', () => {
    expect(true).toBe(true);
  });
});
