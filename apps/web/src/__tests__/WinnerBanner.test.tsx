import type { PlayerToken } from '@eoe/schema';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { WinnerBanner } from '../components/hud/WinnerBanner.js';
import { useSession } from '../store/session.js';

const TOKEN = 'a'.repeat(40) as PlayerToken;

const seedMembership = (code: string): void => {
  useSession.setState({
    games: {
      [code]: {
        playerToken: TOKEN,
        seat: 1,
        civ: 'english',
        name: 'Lando',
      },
    },
    currentGameCode: code,
    currentGameState: null,
    pollState: 'idle',
    error: null,
  });
};

describe('<WinnerBanner />', () => {
  beforeEach(() => {
    window.location.hash = '';
    useSession.setState({
      games: {},
      currentGameCode: null,
      currentGameState: null,
      pollState: 'idle',
      error: null,
    });
  });

  it('shows "You won" when viewer is the winner', () => {
    seedMembership('STUB42');
    render(<WinnerBanner gameCode="STUB42" winner={1} viewerSeat={1} />);
    const banner = screen.getByTestId('winner-banner');
    expect(banner.getAttribute('data-outcome')).toBe('won');
    expect(banner.textContent).toMatch(/you won/i);
  });

  it('shows "You lost" when viewer is not the winner', () => {
    seedMembership('STUB42');
    render(<WinnerBanner gameCode="STUB42" winner={2} viewerSeat={1} />);
    const banner = screen.getByTestId('winner-banner');
    expect(banner.getAttribute('data-outcome')).toBe('lost');
    expect(banner.textContent).toMatch(/you lost/i);
    expect(banner.textContent).toMatch(/seat 2/i);
  });

  it('"New game" clears membership and navigates home', () => {
    seedMembership('STUB42');
    render(<WinnerBanner gameCode="STUB42" winner={1} viewerSeat={1} />);
    fireEvent.click(screen.getByTestId('winner-banner-new-game'));
    expect(useSession.getState().games['STUB42']).toBeUndefined();
    expect(window.location.hash).toBe('#/');
  });
});
