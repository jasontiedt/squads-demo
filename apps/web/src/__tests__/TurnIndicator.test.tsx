import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TurnIndicator } from '../components/hud/TurnIndicator.js';

describe('<TurnIndicator />', () => {
  it('shows "Your turn" when active player is the viewer', () => {
    render(<TurnIndicator activePlayer={1} phase="mobilization" viewerSeat={1} />);
    const el = screen.getByTestId('turn-indicator');
    expect(el.getAttribute('data-your-turn')).toBe('true');
    expect(el.getAttribute('data-active-player')).toBe('1');
    expect(el.getAttribute('data-phase')).toBe('mobilization');
    expect(el.textContent).toMatch(/your turn/i);
    expect(el.textContent).toMatch(/seat 1/i);
  });

  it('shows "Waiting for Seat N" when active player is not the viewer', () => {
    render(<TurnIndicator activePlayer={2} phase="deployment" viewerSeat={1} />);
    const el = screen.getByTestId('turn-indicator');
    expect(el.getAttribute('data-your-turn')).toBe('false');
    expect(el.getAttribute('data-active-player')).toBe('2');
    expect(el.textContent).toMatch(/waiting for seat 2/i);
    expect(el.textContent).toMatch(/deployment/i);
  });

  it('returns null when phase is "ended"', () => {
    const { container } = render(
      <TurnIndicator activePlayer={1} phase="ended" viewerSeat={1} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
