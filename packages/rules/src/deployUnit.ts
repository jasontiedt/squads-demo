import { loadCivMeta } from '@eoe/assets-meta';
import {
  type Action,
  type GameState,
  type Seat,
  type UnitInstance,
  UnitInstanceId,
} from '@eoe/schema';

import { exhaustForCost } from './exhaustForCost.js';
import { legalDeploySquares } from './queries.js';
import { err, ok, type Result } from './result.js';

// ─────────────────────────── deployUnit ──────────────────────────────
//
// Issue #8 — MVP Capital-pawn deploy.
//
// Pure function: `(state, action, actorId) → Result<GameState>`. Phase
// and seat gating happen upstream in `applyAction`; this handler only
// runs once those checks pass. It validates the deploy-specific
// preconditions and, on success, returns a NEW `GameState` with:
//
//   - card moved from hand → discard
//   - resource tokens exhausted to pay the card cost
//   - fresh `UnitInstance` placed on the capital square
//   - all other state preserved by reference (no deep clone)
//
// MVP scope (per the issue):
//   - Deploy onto the actor's revealed `player.capitalSquare`, or onto a
//     revealed square Chebyshev-adjacent to an owned ready Barracks.
//   - Cost paid from `player.resources` (`ResourceToken[]`) by
//     exhausting unexhausted tokens. We do NOT remove tokens — Camps
//     regenerate them on Start of Turn (rulebook §"Start of Turn").
//   - `wild` cost may be satisfied by ANY unexhausted kind. Non-wild
//     costs require an exact-kind match.
//   - No cooldown, no ability resolution, no second-action lockout,
//     no supply limits, no Unit-Field pawn-slot occupancy check.
//
// `@needs-confirmation` — see `__tests__/deployUnit.test.ts`:
//   1. Capital stacking — MVP allows N units to share the Capital square.
//      Rulebook may restrict; pinned as a `it.skip` until Cassian
//      confirms.
//   2. Newly-deployed units enter UN-exhausted (can act on the same
//      turn). Rulebook typically forbids; pinned likewise.
//
// Determinism: the `UnitInstance.id` is generated positionally from
// `turn`, `actorId`, and the count of the actor's existing units —
// NO RNG, NO clock. Two identical inputs MUST produce byte-equal
// outputs. The unit test pins this with `JSON.stringify` equality.

type DeployUnitAction = Extract<Action, { type: 'DeployUnit' }>;

export function deployUnit(
  state: GameState,
  action: DeployUnitAction,
  actorId: Seat,
): Result<GameState> {
  // Players is `Record<Seat, Player | undefined>` under
  // `noUncheckedIndexedAccess`. Upstream gates ensure activePlayer
  // exists, but we re-check defensively rather than assert.
  const player = state.players[actorId];
  if (player === undefined) {
    return err(
      'not_your_turn',
      `no player seated at ${actorId} (defensive — upstream gate should catch this)`,
    );
  }

  // 1) Hand membership.
  const handIdx = player.hand.indexOf(action.cardId);
  if (handIdx < 0) {
    return err('card_not_in_hand', `card ${action.cardId} is not in seat ${actorId}'s hand`);
  }

  // 2) Catalog lookup. `loadCivMeta` returns parsed `Card` records for
  //    the player's civ. Compile-time JSON imports — no runtime I/O.
  const catalog = loadCivMeta(player.civ);
  const card = catalog.find((c) => c.id === action.cardId);
  if (card === undefined) {
    return err(
      'card_not_in_catalog',
      `card ${action.cardId} not found in catalog for civ ${player.civ}`,
    );
  }

  // 3) Kind check.
  if (card.kind !== 'unit') {
    return err('card_not_unit', `card ${action.cardId} has kind '${card.kind}', not 'unit'`);
  }

  // 4) Issue #53: target tile must be revealed (faceDown:false).
  //     We locate the tile containing the target square by scanning
  //     `state.map.tiles`. A square belongs to exactly one tile, so
  //     the first match wins. If no tile contains the target square,
  //     the placement zone is undefined and we reject. We do this
  //     before zone-membership validation so the established "face-down"
  //     error path remains visible to callers/tests.
  const targetTile = state.map.tiles.find((t) =>
    t.squares.some((s) => s.coord.x === action.square.x && s.coord.y === action.square.y),
  );
  if (targetTile === undefined) {
    return err(
      'invalid_deploy_square',
      `target square (${action.square.x},${action.square.y}) is not on any tile`,
    );
  }
  if (targetTile.faceDown) {
    return err(
      'invalid_deploy_square',
      `target tile ${targetTile.id} is face-down; reveal via Scout before deploying`,
    );
  }

  // 4b) Legal deploy zone: Capital square OR a revealed square
  //     Chebyshev-adjacent to an owned, ready Barracks.
  if (
    !legalDeploySquares(state, actorId).some(
      (square) => square.x === action.square.x && square.y === action.square.y,
    )
  ) {
    return err(
      'invalid_deploy_square',
      `DeployUnit must target the Capital square or a revealed square adjacent to a ready Barracks; got (${action.square.x},${action.square.y})`,
    );
  }

  // 5) Capital stacking: MVP allows. See needs-confirmation test.
  //    No occupancy check here.

  // 6) Pay resource cost.
  const payment = exhaustForCost(player.resources, card.cost);
  if (!payment.ok) return payment;

  // 7) Build the new unit instance. Positional id — deterministic.
  const seatUnitCount = state.units.reduce((acc, u) => (u.owner === actorId ? acc + 1 : acc), 0);
  const idRaw = `unit-${state.turn}-${actorId}-${seatUnitCount}`;
  // `.parse` here is cheap (single-string validation) and gives us the
  // branded `UnitInstanceId` without a cast.
  const newId = UnitInstanceId.parse(idRaw);

  const newUnit: UnitInstance = {
    id: newId,
    cardId: action.cardId,
    owner: actorId,
    square: { x: action.square.x, y: action.square.y },
    // @needs-confirmation: newly-deployed units start UN-exhausted.
    // Pinned in deployUnit.test.ts.
    exhausted: false,
    damage: 0,
    // Most units default to melee. `SwitchAttackMode` toggles later.
    attackMode: 'melee',
    upgrades: [],
  };

  // 8) Move card hand → discard. Remove first occurrence only — hand
  //    may legally contain duplicates.
  const newHand = [...player.hand.slice(0, handIdx), ...player.hand.slice(handIdx + 1)];
  const newDiscard = [...player.discard, action.cardId];

  // 9) Assemble new state. Reuse references for everything we did
  //    not change (buildings, map, moveLog, other players).
  const newPlayer = {
    ...player,
    hand: newHand,
    discard: newDiscard,
    resources: payment.value,
  };

  return ok({
    ...state,
    version: state.version + 1,
    players: { ...state.players, [actorId]: newPlayer },
    units: [...state.units, newUnit],
  });
}
