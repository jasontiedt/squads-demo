import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameApiProvider } from '../api/context.js';
import { MockGameApi } from '../api/mock.js';
import { placeholderState } from '../api/client.js';
import { Lobby } from '../views/Lobby.js';
import { useSession } from '../store/session.js';
import type { PlayerToken } from '@eoe/schema';

const seedMembership = (code: string): void => {
  useSession.setState({
    games: {
      [code]: {
        playerToken: 'a'.repeat(40) as PlayerToken,
        seat: 1,
        civ: 'english',
        name: 'Lando',
      },
    },
    currentGameCode: code,
    currentGameState: placeholderState(code),
    pollState: 'active',
    error: null,
  });
};

describe('<Lobby />', () => {
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

  it('shows gameCode + seat + phase when membership exists', () => {
    seedMembership('STUB42');
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    expect(screen.getByRole('heading', { name: /game stub42/i })).toBeDefined();
    // "You are" row contains the seat as <strong>1</strong>.
    expect(screen.getByText(/Lando.*seat.*english/i)).toBeDefined();
    expect(screen.getByText(/mobilization/i)).toBeDefined();
    expect(screen.getByText(/game ui lands in #15/i)).toBeDefined();
  });

  it('shows "you don\'t have a token" when membership is missing', () => {
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="NOPE99" />
      </GameApiProvider>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /don't have a player token/i,
    );
    expect(screen.getByRole('button', { name: /back to home/i })).toBeDefined();
  });

  it('"Leave game" clears membership and navigates home', async () => {
    seedMembership('STUB42');
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /leave game/i }));
    await waitFor(() => {
      expect(useSession.getState().games['STUB42']).toBeUndefined();
    });
    expect(window.location.hash).toBe('#/');
  });

  it('fetches game state on mount when membership exists but state is empty (rehydrate path)', async () => {
    // Simulate a reload: persisted membership in store, no current state.
    const api = new MockGameApi();
    // Pre-create the game in the mock so getGame succeeds with the right token.
    const created = await api.createGame({ name: 'Lando', civ: 'english' });
    useSession.setState({
      games: {
        [created.gameCode]: {
          playerToken: created.playerToken,
          seat: created.seat,
          civ: 'english',
          name: 'Lando',
        },
      },
      currentGameCode: null,
      currentGameState: null,
      pollState: 'idle',
      error: null,
    });
    render(
      <GameApiProvider api={api}>
        <Lobby gameCode={created.gameCode} />
      </GameApiProvider>,
    );
    await waitFor(() => {
      expect(useSession.getState().currentGameState).not.toBeNull();
    });
    expect(useSession.getState().pollState).toBe('active');
  });
});
