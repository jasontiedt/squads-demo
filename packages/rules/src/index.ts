import type { Action, GameState, PlayerId, RuleError } from '@eoe/schema';

/** Standard discriminated Result type used across the rules engine. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Pure rules-engine entry point. Deterministic, no I/O, no Math.random
 * (RNG must be seeded from state when needed).
 *
 * Imported by both the web client (for instant client-side validation)
 * and the Worker (authoritative re-validation). Worker's verdict wins.
 *
 * Cards register here: import './cards/{civ}/{cardId}'
 */
export function applyAction(
  _state: GameState,
  _action: Action,
  _actorId: PlayerId,
): Result<GameState, RuleError> {
  return {
    ok: false,
    error: {
      code: 'not_implemented',
      message: 'applyAction is a stub. Artoo wires up draw/play/end_turn next.',
    },
  };
}
