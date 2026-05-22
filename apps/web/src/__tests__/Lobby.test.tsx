import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GameApiProvider } from '../api/context.js';
import { MockGameApi } from '../api/mock.js';
import {
  AuthError,
  VersionMismatchError,
  placeholderState,
  type GameApi,
  type PublicGameState,
  type RedactedPlayer,
} from '../api/client.js';
import { Lobby } from '../views/Lobby.js';
import { useSession } from '../store/session.js';
import type { PlayerToken, Seat } from '@eoe/schema';

const TOKEN = 'a'.repeat(40) as PlayerToken;

const makePlayer = (seat: Seat, handCount: number): RedactedPlayer =>
  ({
    seat,
    civ: 'english',
    capitalHp: 10,
    capitalSquare: { x: 0, y: 0 },
    hand: { count: handCount },
    deck: [],
    discard: [],
    resources: [],
    temporaryResources: [],
    activeEvents: [],
    unitField: { kingPawnUsed: false, queenPawnUsed: false },
    civCardId: 'civ:english',
  }) as unknown as RedactedPlayer;

const makeState = (
  gameId: string,
  handCount = 3,
  overrides: Partial<PublicGameState> = {},
): PublicGameState => ({
  ...placeholderState(gameId),
  players: { 1: makePlayer(1, handCount) },
  ...overrides,
});

const seedMembership = (
  code: string,
  state: PublicGameState | null = makeState(code),
): void => {
  useSession.setState({
    games: {
      [code]: {
        playerToken: TOKEN,
        seat: 1,
        civ: 'english',
        name: 'Lando',
      },
    },
    currentGameCode: state === null ? null : code,
    currentGameState: state,
    pollState: state === null ? 'idle' : 'active',
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

  afterEach(() => {
    // Guard against fake-timer leakage from earlier tests.
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shows gameCode + seat + phase when membership exists', () => {
    seedMembership('STUB42');
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    expect(screen.getByRole('heading', { name: /game stub42/i })).toBeDefined();
    expect(screen.getByText(/Lando.*seat.*english/i)).toBeDefined();
    expect(screen.getByTestId('phase').textContent).toMatch(/mobilization/i);
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

  it('fetches game state on mount when state is empty (rehydrate path)', async () => {
    const api = new MockGameApi();
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

  it('renders the hand count as N face-down tiles', () => {
    seedMembership('STUB42', makeState('STUB42', 5));
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    expect(screen.getByTestId('hand-count').textContent).toBe('5');
    expect(
      screen.getAllByLabelText(/face-down card/i),
    ).toHaveLength(5);
  });

  // ---- Polling --------------------------------------------------------

  it('polls every ~2s and updates store state', async () => {
    const getGame = vi
      .fn()
      .mockResolvedValue({
        state: makeState('STUB42', 4, { version: 1 }),
        seat: 1 as Seat,
      });
    const api: GameApi = {
      getGame,
      createGame: vi.fn(),
      joinGame: vi.fn(),
      postAction: vi.fn(),
    };

    seedMembership('STUB42', makeState('STUB42', 3, { version: 0 }));
    render(
      <GameApiProvider api={api}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );

    await waitFor(
      () => {
        expect(getGame).toHaveBeenCalled();
        expect(useSession.getState().currentGameState?.version).toBe(1);
      },
      { timeout: 4000, interval: 100 },
    );
  });

  // ---- Action dispatch ------------------------------------------------

  it('End phase button posts EndPhase action when it is your turn', async () => {
    const postAction = vi
      .fn()
      .mockResolvedValueOnce({
        state: makeState('STUB42', 3, { version: 1 }),
        version: 1,
      });
    const api: GameApi = {
      getGame: vi.fn().mockResolvedValue({
        state: makeState('STUB42', 3, { version: 1 }),
        seat: 1 as Seat,
      }),
      createGame: vi.fn(),
      joinGame: vi.fn(),
      postAction,
    };
    seedMembership('STUB42', makeState('STUB42', 3, { version: 0 }));

    render(
      <GameApiProvider api={api}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    const btn = screen.getByRole('button', { name: /end phase/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(postAction).toHaveBeenCalledTimes(1);
    });
    const [arg] = postAction.mock.calls[0] as [
      Parameters<GameApi['postAction']>[0],
    ];
    expect(arg.action).toEqual({ type: 'EndPhase' });
    expect(arg.expectedVersion).toBe(0);
  });

  it('End phase / End turn are disabled when it is not your turn', () => {
    seedMembership('STUB42', makeState('STUB42', 3, { activePlayer: 2 }));
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    expect(
      (screen.getByRole('button', { name: /end phase/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: /end turn/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('Play card button is disabled with explanatory title', () => {
    seedMembership('STUB42');
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    // Issue #37: the placeholder generic "Play card" button was
    // removed. Cards in the hand are themselves the click targets.
    // Verify the placeholder is gone (it would have been a button
    // named "Play card" with a title attribute mentioning PlayCard).
    expect(screen.queryByRole('button', { name: /^play card$/i })).toBeNull();
  });

  // ---- 409 retry ------------------------------------------------------

  it('retries postAction once after a 409, with the refetched version', async () => {
    const postAction = vi
      .fn()
      .mockRejectedValueOnce(new VersionMismatchError(5, 0, 'stale'))
      .mockResolvedValueOnce({
        state: makeState('STUB42', 3, { version: 6 }),
        version: 6,
      });
    const getGame = vi.fn().mockResolvedValue({
      state: makeState('STUB42', 3, { version: 5 }),
      seat: 1 as Seat,
    });
    const api: GameApi = {
      getGame,
      createGame: vi.fn(),
      joinGame: vi.fn(),
      postAction,
    };
    seedMembership('STUB42', makeState('STUB42', 3, { version: 0 }));

    render(
      <GameApiProvider api={api}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /end phase/i }));

    await waitFor(() => {
      expect(postAction).toHaveBeenCalledTimes(2);
    });
    const [secondCall] = postAction.mock.calls[1] as [
      Parameters<GameApi['postAction']>[0],
    ];
    expect(secondCall.expectedVersion).toBe(5);
    await waitFor(() => {
      expect(useSession.getState().currentGameState?.version).toBe(6);
    });
  });

  // ---- 401 handling ---------------------------------------------------

  it('clears membership and navigates home when polling returns 401', async () => {
    const getGame = vi
      .fn()
      .mockRejectedValue(new AuthError('signed out'));
    const api: GameApi = {
      getGame,
      createGame: vi.fn(),
      joinGame: vi.fn(),
      postAction: vi.fn(),
    };
    seedMembership('STUB42', makeState('STUB42', 3, { version: 0 }));

    render(
      <GameApiProvider api={api}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );

    await waitFor(
      () => {
        expect(useSession.getState().games['STUB42']).toBeUndefined();
      },
      { timeout: 4000, interval: 100 },
    );
    expect(window.location.hash).toBe('#/');
  });
});
