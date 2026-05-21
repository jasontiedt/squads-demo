import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameApiProvider } from '../api/context.js';
import { MockGameApi } from '../api/mock.js';
import { ApiError } from '../api/client.js';
import type { GameApi } from '../api/client.js';
import { Home } from '../views/Home.js';
import { useSession } from '../store/session.js';

const renderHome = (api: GameApi = new MockGameApi()): void => {
  render(
    <GameApiProvider api={api}>
      <Home />
    </GameApiProvider>,
  );
};

const setInput = (label: RegExp, value: string): void => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
};

describe('<Home />', () => {
  beforeEach(() => {
    window.location.hash = '';
    useSession.setState({
      games: {},
      pollState: 'idle',
      error: null,
      currentGameCode: null,
      currentGameState: null,
    });
  });

  it('renders both Create and Join tabs', () => {
    renderHome();
    expect(screen.getByRole('tab', { name: /create game/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /join game/i })).toBeDefined();
  });

  it('shows the Create form by default', () => {
    renderHome();
    expect(screen.getByRole('form', { name: /create game/i })).toBeDefined();
  });

  it('switches to the Join form when the Join tab is clicked', () => {
    renderHome();
    fireEvent.click(screen.getByRole('tab', { name: /join game/i }));
    expect(screen.getByRole('form', { name: /join game/i })).toBeDefined();
  });

  it('rejects empty name on create', async () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: /create game/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/name is required/i);
  });

  it('rejects invalid game code on join', async () => {
    renderHome();
    fireEvent.click(screen.getByRole('tab', { name: /join game/i }));
    setInput(/game code/i, 'abc'); // too short
    setInput(/your name/i, 'Lando');
    fireEvent.click(screen.getByRole('button', { name: /join game/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/4–6/);
  });

  it('persists membership + navigates to lobby after successful create', async () => {
    renderHome(new MockGameApi({ nextGameCode: 'STUB99' }));
    setInput(/your name/i, 'Lando');
    fireEvent.click(screen.getByRole('button', { name: /create game/i }));
    await waitFor(() => {
      expect(useSession.getState().games['STUB99']).toBeDefined();
    });
    expect(window.location.hash).toBe('#/g/STUB99');
    expect(useSession.getState().games['STUB99']?.seat).toBe(1);
  });

  it('renders error state when the API throws', async () => {
    class FailingApi implements GameApi {
      async createGame(): Promise<never> {
        throw new ApiError('boom', 'mock failure');
      }
      async joinGame(): Promise<never> {
        throw new ApiError('boom', 'mock failure');
      }
      async getGame(): Promise<never> {
        throw new ApiError('boom', 'mock failure');
      }
    }
    renderHome(new FailingApi());
    setInput(/your name/i, 'Lando');
    fireEvent.click(screen.getByRole('button', { name: /create game/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/mock failure/i);
    expect(useSession.getState().pollState).toBe('error');
    expect(useSession.getState().games).toEqual({});
  });
});
