// ─────────────────────────── Winner banner ─────────────────────────
//
// Full-screen overlay rendered when `state.phase === 'ended'`. The text
// switches based on the viewer's seat:
//   - viewer is `state.winner`         → "You won"
//   - viewer is on the roster but lost → "You lost"
//   - viewer is a spectator (no seat)  → "Seat N wins"
//
// A "New game" button clears the viewer's membership for this game and
// routes back to home. The seat is required to clear the right slot in
// the session store.
//
// Design tokens are inline defaults — Sabine is consulting and can
// polish via tokens.css later (see lando-hud-tokens.md).

import type { Seat } from '@eoe/schema';

import { navigate } from '../../router/hash.js';
import { useSession } from '../../store/session.js';

export interface WinnerBannerProps {
  /** Game code — used to clear the right membership on "New game". */
  gameCode: string;
  /** Seat that won. Required when the banner is shown. */
  winner: Seat;
  /** The viewer's seat in this game (from membership). */
  viewerSeat: Seat;
}

export const WinnerBanner = ({
  gameCode,
  winner,
  viewerSeat,
}: WinnerBannerProps): JSX.Element => {
  const leaveGame = useSession((s) => s.leaveGame);

  const youWon = winner === viewerSeat;
  const headline = youWon ? 'You won' : 'You lost';
  const subline = youWon
    ? `Seat ${winner} is victorious — that's you.`
    : `Seat ${winner} took the win.`;

  const onNewGame = (): void => {
    leaveGame(gameCode);
    navigate({ name: 'home' });
  };

  return (
    <div
      data-testid="winner-banner"
      data-winner-seat={winner}
      data-viewer-seat={viewerSeat}
      data-outcome={youWon ? 'won' : 'lost'}
      className="winner-banner"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="winner-banner-headline"
    >
      <div className="winner-banner-card">
        <h2
          id="winner-banner-headline"
          className={`winner-banner-headline${youWon ? ' winner-banner-headline-won' : ''}`}
        >
          {headline}
        </h2>
        <p className="winner-banner-sub">{subline}</p>
        <button
          type="button"
          data-testid="winner-banner-new-game"
          className="winner-banner-button"
          onClick={onNewGame}
        >
          New game
        </button>
      </div>
    </div>
  );
};
