import { loadCivMeta } from '@eoe/assets-meta';
import type {
  CardId,
  Effect,
  GameState,
  HealCapitalEffect,
  Seat,
  UnitInstance,
} from '@eoe/schema';

import { CAPITAL_DEFAULT_HP } from '../constants.js';
import { drawCard } from '../draw.js';
import { err, ok, type Result } from '../result.js';
import { applyAttachKeyword } from './attachKeyword.js';
import { applyClassWidePassive } from './classWidePassive.js';

// ─────────────────────────── Effect dispatcher (Issue #85) ───────────
//
// Pure pattern-match over the 5-verb `Effect` discriminatedUnion from
// `@eoe/schema` (#83). Called by `playAction.ts` AFTER cost is paid and
// the played card has moved hand → discard. Returns a `Result<GameState>`;
// the PlayAction handler is responsible for atomic rollback if this
// errors (it returns the ORIGINAL pre-cost state, not the intermediate).
//
// MVP-5 scope cut for #85:
//   • `draw` — fully implemented (delegates to `drawCard`).
//   • `buff-unit-stat` — fully implemented (appends to UnitInstance
//     `temporaryBuffs`; supports all 3 target shapes).
//   • `damage`, `gain-temporary-resource` — stubbed, return
//     `err('not_implemented', ...)`. Implementations follow in
//     future issues once damage / capital-heal / temp-resource grants
//     have their own design notes.
//
// MVP-6 S2 (#98): extends the union to 7 verbs. Both new verbs are
// pure registrations (no card-rule lifecycle); see
// `./attachKeyword.ts` and `./classWidePassive.ts` for shape rationale.
//   • `attach-keyword`      — appends to `UnitInstance.attachments`.
//   • `class-wide-passive`  — pushes onto `state.classWidePassives`.
//
// Determinism: no RNG, no clock, no I/O. `loadCivMeta` is a compile-time
// JSON import.

export interface EffectContext {
  readonly actorSeat: Seat;
  readonly cardId: CardId;
}

/**
 * Dispatch a single typed `Effect` against the game state. Caller has
 * already paid cost, moved the source card to discard, and validated
 * phase / seat ownership — this is purely effect resolution.
 */
export function dispatchEffect(
  state: GameState,
  effect: Effect,
  ctx: EffectContext,
): Result<GameState> {
  switch (effect.kind) {
    case 'draw':
      return applyDraw(state, effect, ctx);
    case 'buff-unit-stat':
      return applyBuffUnitStat(state, effect, ctx);
    case 'attach-keyword':
      return applyAttachKeyword(state, effect, ctx);
    case 'class-wide-passive':
      return applyClassWidePassive(state, effect, ctx);
    case 'damage':
      return err(
        'not_implemented',
        `damage effect is not yet implemented (scope-cut from #85; effects/dispatch.ts MVP ships draw + buff-unit-stat only)`,
      );
    case 'heal-capital':
      return applyHealCapital(state, effect, ctx);
    case 'gain-temporary-resource':
      return err(
        'not_implemented',
        `gain-temporary-resource effect is not yet implemented (scope-cut from #85)`,
      );
    default: {
      // Exhaustiveness — TS flags new effect kinds added to the union
      // that are not handled above.
      const _exhaustive: never = effect;
      void _exhaustive;
      return err(
        'not_implemented',
        `Unknown effect kind (rules drifted from @eoe/schema Effect union)`,
      );
    }
  }
}

// ─────────────────────────── heal-capital ────────────────────────────

function applyHealCapital(
  state: GameState,
  effect: HealCapitalEffect,
  ctx: EffectContext,
): Result<GameState> {
  const player = state.players[ctx.actorSeat];
  if (player === undefined) {
    return err(
      'target_not_found',
      `heal-capital target seat ${ctx.actorSeat} has no player record`,
    );
  }

  return ok({
    ...state,
    players: {
      ...state.players,
      [ctx.actorSeat]: {
        ...player,
        capitalHp: Math.min(CAPITAL_DEFAULT_HP, player.capitalHp + effect.amount),
      },
    },
  });
}

// ─────────────────────────── draw ────────────────────────────────────

function applyDraw(
  state: GameState,
  effect: Extract<Effect, { kind: 'draw' }>,
  ctx: EffectContext,
): Result<GameState> {
  // Per #83, `draw` always targets the active seat (the actor); the
  // schema doesn't carry a target for `draw`. We loop `count` times,
  // stopping early on empty deck (matches the rulebook no-reshuffle
  // rule already encoded in `drawCard`).
  let working = state;
  for (let i = 0; i < effect.count; i++) {
    const next = drawCard(working, ctx.actorSeat);
    if (next.drawn === null) break;
    working = next.state;
  }
  return ok(working);
}

// ─────────────────────────── buff-unit-stat ──────────────────────────

function applyBuffUnitStat(
  state: GameState,
  effect: Extract<Effect, { kind: 'buff-unit-stat' }>,
  ctx: EffectContext,
): Result<GameState> {
  const target = effect.target;
  const matches = selectUnits(state, target, ctx.actorSeat);
  if (matches.kind === 'err') return err(matches.code, matches.message);

  // Append a temporary-buff entry to each matched unit. Existing buffs
  // accumulate — the same end-of-turn cleanup hook will sweep them.
  const matchedIds = new Set(matches.ids);
  const newUnits: UnitInstance[] = state.units.map((u) => {
    if (!matchedIds.has(u.id)) return u;
    const existing = u.temporaryBuffs ?? [];
    return {
      ...u,
      temporaryBuffs: [
        ...existing,
        {
          stat: effect.stat,
          delta: effect.delta,
          expires: 'end-of-turn' as const,
        },
      ],
    };
  });

  return ok({ ...state, units: newUnits });
}

// ─────────────────────────── unit selection helpers ──────────────────

type SelectResult =
  | { kind: 'ok'; ids: ReadonlyArray<UnitInstance['id']> }
  | { kind: 'err'; code: 'target_not_found' | 'target_friendly' | 'not_implemented'; message: string };

/**
 * Resolve a `Target` from #83's effect union to a list of unit ids in
 * `state.units[]`. Capital targets (`'self-capital'` / `'opponent-capital'`)
 * are not supported by `buff-unit-stat` and surface as
 * `'not_implemented'`.
 */
function selectUnits(
  state: GameState,
  target: Extract<Effect, { kind: 'buff-unit-stat' }>['target'],
  actor: Seat,
): SelectResult {
  if (target === 'self-capital' || target === 'opponent-capital') {
    return {
      kind: 'err',
      code: 'not_implemented',
      message: `buff-unit-stat cannot target ${target}; buffs apply to units only`,
    };
  }
  switch (target.kind) {
    case 'unit': {
      const found = state.units.find((u) => u.id === target.unitId);
      if (found === undefined) {
        return {
          kind: 'err',
          code: 'target_not_found',
          message: `unit ${target.unitId} is not on the board`,
        };
      }
      return { kind: 'ok', ids: [found.id] };
    }
    case 'all-own-units': {
      const owned = state.units.filter((u) => u.owner === actor);
      const filtered = filterByClass(state, owned, target.classFilter);
      return { kind: 'ok', ids: filtered.map((u) => u.id) };
    }
    case 'units-by-class': {
      const pool =
        target.ownership === 'own'
          ? state.units.filter((u) => u.owner === actor)
          : state.units.filter((u) => u.owner !== actor);
      const filtered = filterByClass(state, pool, target.classFilter);
      return { kind: 'ok', ids: filtered.map((u) => u.id) };
    }
  }
}

/**
 * Filter units by catalog `class` field. `classFilter` is a single
 * class string (case-sensitive). A unit matches if its card's `class`
 * array contains that string. Units whose card isn't in the catalog or
 * isn't a unit card are dropped (defensive — catalog drift should
 * never happen, but we'd rather skip than crash).
 */
function filterByClass(
  state: GameState,
  units: ReadonlyArray<UnitInstance>,
  classFilter: string | undefined,
): ReadonlyArray<UnitInstance> {
  if (classFilter === undefined) return units;
  return units.filter((u) => {
    const owner = state.players[u.owner];
    if (owner === undefined) return false;
    const card = loadCivMeta(owner.civ).find((c) => c.id === u.cardId);
    if (card === undefined || card.kind !== 'unit') return false;
    return card.class.includes(classFilter);
  });
}
