import type {
  CardCost,
  GameState,
  ResourceKind,
  ResourceToken,
  Seat,
  TemporaryResource,
} from '@eoe/schema';

import { err, ok, type Result } from './result.js';

// ─────────────────────────── payCost (Issue #84) ─────────────────────
//
// Pure helper used by card-effect handlers (DeployUnit, PlayCard, …) to
// pay a card's `CardCost` against `state.players[seat]`'s resources.
//
// Semantics — pinned by the issue:
//   1. For each unit of cost of kind X (≥ 1):
//        a. Consume an unexhausted X token. Try `temporaryResources`
//           FIRST (FIFO in array order, decrementing `current`, dropping
//           entries that hit zero), then permanent `resources` (flip
//           `exhausted` false → true).
//        b. If no unexhausted X is available, fall back to a `wild`
//           token (again: temporary first, then permanent).
//   2. A `wild` cost entry consumes wild tokens directly (temp → perm).
//      It does NOT fall back to other kinds — the rulebook's "wild = any
//      kind" symbol lives on the card cost side, not the token side.
//      (This handler's responsibility is "pay tokens to meet a cost";
//      the existing deployUnit handler's looser interpretation can be
//      reconciled later if catalog data forces it — see decisions/inbox.)
//   3. If any cost unit cannot be paid, returns
//      `err('insufficient_resources', …)` and the input `state` is
//      returned unchanged (deep-equal pre/post — verified by tests).
//   4. Empty cost (`{}` or all zero counts) returns the input state by
//      reference — no allocation, no version bump.
//
// Determinism: array iteration order is the canonical resource order;
// cost entries are walked in `Object.entries` insertion order. No RNG,
// no clock, no I/O.
//
// Version bumping is the caller's responsibility — this is a building
// block, not a top-level action handler. (Composing into deployUnit
// would otherwise double-bump.)

/**
 * Pay a card cost from the seat's resource pool.
 *
 * @returns `ok(newState)` with the seat's `resources` / `temporaryResources`
 *          mutated to reflect payment; `err('insufficient_resources')`
 *          with `state` unchanged on shortfall.
 */
export function payCost(
  state: GameState,
  seat: Seat,
  cost: CardCost,
): Result<GameState> {
  const player = state.players[seat];
  if (player === undefined) {
    // Defensive: callers should gate seat existence upstream. Still
    // surface as `insufficient_resources` (no resources at all to pay
    // with) rather than introducing a new error code.
    return err(
      'insufficient_resources',
      `no player seated at ${seat}; cannot pay cost`,
    );
  }

  // Filter out zero/undefined entries up-front so the empty-cost path
  // is a pure short-circuit.
  const entries = Object.entries(cost).filter(([, v]) => (v ?? 0) > 0);
  if (entries.length === 0) {
    return ok(state);
  }

  // Working copies. Decisions and token state are tracked locally; we
  // only commit a new GameState on full-cost success. On failure these
  // are thrown away and `state` is returned untouched.
  const tempWorking: TemporaryResource[] = player.temporaryResources.map(
    (t) => ({ ...t }),
  );
  const permExhausted: boolean[] = player.resources.map((r) => r.exhausted);

  // Try to consume one temporary token of `kind`. FIFO by array index;
  // decrements `current` by 1 (entries with `current === 0` are filtered
  // at commit time so they don't accidentally pay further units here).
  const consumeTemp = (kind: ResourceKind): boolean => {
    for (let i = 0; i < tempWorking.length; i++) {
      const t = tempWorking[i];
      if (t !== undefined && t.kind === kind && t.current > 0) {
        tempWorking[i] = { ...t, current: t.current - 1 };
        return true;
      }
    }
    return false;
  };

  // Try to exhaust one permanent token of `kind`. First unexhausted
  // match wins (array order).
  const consumePermanent = (kind: ResourceKind): boolean => {
    for (let i = 0; i < permExhausted.length; i++) {
      if (permExhausted[i] === true) continue;
      const tok = player.resources[i];
      if (tok !== undefined && tok.kind === kind) {
        permExhausted[i] = true;
        return true;
      }
    }
    return false;
  };

  // Pay one unit of `kind`. Temp-first, perm-second, wild-fallback for
  // non-wild kinds. A `wild` cost entry sticks to wild tokens.
  const payOne = (kind: ResourceKind): boolean => {
    if (consumeTemp(kind)) return true;
    if (consumePermanent(kind)) return true;
    if (kind === 'wild') return false;
    if (consumeTemp('wild')) return true;
    if (consumePermanent('wild')) return true;
    return false;
  };

  // Tally shortfalls instead of bailing on the first miss — the error
  // message then carries an accurate `missing` summary.
  const missing: Partial<Record<string, number>> = {};

  for (const [rawKind, rawCount] of entries) {
    const kind = rawKind as ResourceKind;
    const count = rawCount ?? 0;
    for (let n = 0; n < count; n++) {
      if (!payOne(kind)) {
        missing[kind] = (missing[kind] ?? 0) + 1;
      }
    }
  }

  if (Object.keys(missing).length > 0) {
    return err(
      'insufficient_resources',
      `seat ${seat} cannot pay cost ${JSON.stringify(cost)}; missing ${JSON.stringify(missing)}`,
    );
  }

  // Commit: drop temp entries that bottomed out, rebuild permanent
  // tokens with new `exhausted` flags, swap the player into a fresh
  // `players` record. Everything else on `state` is reused by reference.
  const newTemp: TemporaryResource[] = tempWorking.filter(
    (t) => t.current > 0,
  );
  const newPerm: ResourceToken[] = player.resources.map((r, i) => ({
    ...r,
    exhausted: permExhausted[i] ?? r.exhausted,
  }));

  const newPlayer = {
    ...player,
    resources: newPerm,
    temporaryResources: newTemp,
  };

  return ok({
    ...state,
    players: { ...state.players, [seat]: newPlayer },
  });
}
