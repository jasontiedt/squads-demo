/**
 * ReactionWindowModal — MVP-6 S6 (issue #102).
 *
 * Rendered by `Lobby` only when `state.pendingReactionWindow !== undefined`
 * AND `pendingReactionWindow.eligibleSeat === localSeat`. The opponent
 * sees nothing (the modal is local-eligible-only).
 *
 * Behaviour pins (per issue #102):
 *   • Lists reaction cards from the eligible seat's hand whose
 *     `trigger.kind` matches the open window's `trigger.kind`.
 *     Eligibility is delegated to `eligibleReactions` from
 *     `@eoe/rules` — UI never re-implements rules logic.
 *   • A "Pass" button dispatches `PassReaction` to close the window.
 *   • Clicking a card dispatches `PlayReaction` with the cardId and
 *     `triggerLogIndex` derived from `state.moveLog.length - 1` (the
 *     log entry that opened the window).
 *
 * The dispatch callbacks are passed in by Lobby (which owns the
 * Worker-bound dispatch path with 409 retry) — this component is
 * pure render + click forwarding.
 */
import type { JSX } from 'react';
import type {
  CardId,
  GameState,
  ReactionCard,
  Seat,
} from '@eoe/schema';
import { eligibleReactions } from '@eoe/rules';
import { loadCivMeta } from '@eoe/assets-meta';
import type { PublicGameState } from '../api/client.js';

/** Human-readable labels for the closed 5-trigger taxonomy
 *  (`packages/schema/src/triggers.ts`). Kept inline because the set
 *  is closed and we want the modal to be self-contained. */
const TRIGGER_LABEL: Record<string, string> = {
  'on-attack-declared': 'Attack declared',
  'on-damage-dealt': 'Damage dealt',
  'on-unit-destroyed': 'Unit destroyed',
  'on-card-played': 'Card played',
  'on-phase-end': 'Phase end',
};

export interface ReactionWindowModalProps {
  state: PublicGameState;
  localSeat: Seat;
  /** Disable buttons while a Worker call is in flight. */
  disabled?: boolean;
  onPlayReaction: (cardId: CardId, triggerLogIndex: number) => void;
  onPassReaction: () => void;
}

export const ReactionWindowModal = ({
  state,
  localSeat,
  disabled = false,
  onPlayReaction,
  onPassReaction,
}: ReactionWindowModalProps): JSX.Element | null => {
  const window = state.pendingReactionWindow;
  if (window === undefined) return null;
  if (window.eligibleSeat !== localSeat) return null;

  // `eligibleReactions` reads `state.players[seat].hand` as `CardId[]`.
  // `PublicGameState.players[seat].hand` is the redacted union
  // (`CardId[] | { count }`) but for the LOCAL seat under a Bearer
  // token the worker un-redacts the hand to an array — which is the
  // only path where this modal renders. The cast is therefore
  // structurally safe; we narrow at the property the helper reads.
  const ownPlayer = state.players[localSeat];
  if (ownPlayer === undefined) return null;
  if (!Array.isArray(ownPlayer.hand)) return null;

  const eligibles: ReadonlyArray<ReactionCard> = eligibleReactions(
    state as unknown as GameState,
    localSeat,
  );

  // `triggerLogIndex` per `PlayReactionAction` schema: index of the
  // ActionLogEntry that opened the window. The Worker emits the
  // trigger immediately after appending the log entry, so the open
  // window always corresponds to `moveLog.length - 1`.
  const triggerLogIndex = Math.max(0, state.moveLog.length - 1);

  const triggerLabel = TRIGGER_LABEL[window.trigger.kind] ?? window.trigger.kind;
  const catalog = loadCivMeta(ownPlayer.civ);
  const nameOf = (cardId: CardId): string => {
    const card = catalog.find((c) => c.id === cardId);
    return card?.name ?? cardId;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reaction-window-title"
      className="reaction-window-backdrop"
      data-testid="reaction-window-modal"
      data-trigger-kind={window.trigger.kind}
    >
      <div className="reaction-window-card">
        <h2 id="reaction-window-title" className="reaction-window-title">
          Reaction window — <span className="reaction-window-trigger">{triggerLabel}</span>
        </h2>
        <p className="reaction-window-help">
          {eligibles.length === 0
            ? 'You have no matching reaction cards in hand.'
            : 'Play a reaction or pass to close the window.'}
        </p>

        {eligibles.length > 0 && (
          <ul className="reaction-window-list" role="list">
            {eligibles.map((card) => (
              <li key={card.id} className="reaction-window-item">
                <button
                  type="button"
                  data-testid={`reaction-play-${card.id}`}
                  className="reaction-window-play-btn"
                  disabled={disabled}
                  onClick={() => onPlayReaction(card.id, triggerLogIndex)}
                >
                  Play <strong>{nameOf(card.id)}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="reaction-window-footer">
          <button
            type="button"
            data-testid="reaction-pass-btn"
            className="reaction-window-pass-btn"
            disabled={disabled}
            onClick={onPassReaction}
          >
            Pass
          </button>
        </div>
      </div>
    </div>
  );
};
