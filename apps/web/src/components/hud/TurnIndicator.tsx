// ─────────────────────────── Turn indicator ────────────────────────
//
// Top-of-screen banner that tells the viewer whose turn it is, which
// phase the game is in, and whether the viewer should be acting or
// waiting.
//
// Hidden when `phase === 'ended'` — the WinnerBanner overlay takes
// over the messaging at that point.

import type { Seat, TurnPhase } from '@eoe/schema';

export interface TurnIndicatorProps {
  activePlayer: Seat;
  phase: TurnPhase;
  viewerSeat: Seat;
}

/** Title-case the phase for display ('mobilization' → 'Mobilization'). */
const formatPhase = (phase: TurnPhase): string =>
  phase.charAt(0).toUpperCase() + phase.slice(1);

export const TurnIndicator = ({
  activePlayer,
  phase,
  viewerSeat,
}: TurnIndicatorProps): JSX.Element | null => {
  if (phase === 'ended') return null;

  const yourTurn = activePlayer === viewerSeat;
  const perspective = yourTurn
    ? 'Your turn'
    : `Waiting for Seat ${activePlayer}`;

  return (
    <div
      data-testid="turn-indicator"
      data-active-player={activePlayer}
      data-viewer-seat={viewerSeat}
      data-your-turn={yourTurn ? 'true' : 'false'}
      data-phase={phase}
      className={`turn-indicator${yourTurn ? ' turn-indicator-your-turn' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="turn-indicator-seat">
        Seat {activePlayer}'s turn
      </span>
      <span className="turn-indicator-divider" aria-hidden="true">
        ·
      </span>
      <span className="turn-indicator-phase">{formatPhase(phase)}</span>
      <span className="turn-indicator-divider" aria-hidden="true">
        ·
      </span>
      <span
        className="turn-indicator-perspective"
        data-testid="turn-indicator-perspective"
      >
        {perspective}
      </span>
    </div>
  );
};
