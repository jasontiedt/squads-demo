/**
 * Issue #37 — PlayCard UI tests.
 *
 * Un-skipped now that issue #38 (Bearer-token GET) shipped on `main`:
 * the worker un-redacts the calling seat's own hand on create / join /
 * Bearer GET / POST action responses (apps/worker/src/redact.ts). The
 * client receives `CardId[]` for its own hand and can dispatch
 * `PlayCard` on a specific cardId.
 *
 * These tests mirror the existing EndPhase/EndTurn patterns in
 * `Lobby.test.tsx` (dispatch + 409 retry + error surfacing). They pin
 * the 6 behaviors originally enumerated in this file's needs-confirm
 * block:
 *   1. One clickable button per cardId, testid `card-{cardId}`.
 *   2. Click dispatches PlayCard with current state.version.
 *   3. Click no-op when activePlayer != mySeat.
 *   4. Click no-op outside mobilization / deployment phases.
 *   5. 409 retry mirrors EndPhase/EndTurn.
 *   6. Engine InvalidActionError surfaces via action-error.
 */
import type { CardId, PlayerToken, Seat } from '@eoe/schema';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    InvalidActionError,
    VersionMismatchError,
    placeholderState,
    type GameApi,
    type PublicGameState,
    type RedactedPlayer,
} from '../api/client.js';
import { GameApiProvider } from '../api/context.js';
import { MockGameApi } from '../api/mock.js';
import { useSession } from '../store/session.js';
import { Lobby } from '../views/Lobby.js';

const TOKEN = 'a'.repeat(40) as PlayerToken;
const CARDS = ['eng-tactic-1', 'eng-tactic-2', 'eng-tech-1'] as unknown as readonly CardId[];

const makePlayer = (
  seat: Seat,
  hand: readonly CardId[] | { count: number },
): RedactedPlayer =>
  ({
    seat,
    civ: 'english',
    capitalHp: 10,
    capitalSquare: { x: 0, y: 0 },
    hand,
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
  hand: readonly CardId[] | { count: number } = CARDS,
  overrides: Partial<PublicGameState> = {},
): PublicGameState => ({
  ...placeholderState(gameId),
  players: { 1: makePlayer(1, hand) },
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

describe('PlayCard UI — issue #37', () => {
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

  it('renders one clickable button per cardId with testid card-{cardId}', () => {
    seedMembership('STUB42', makeState('STUB42', CARDS));
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    for (const cardId of CARDS) {
      const btn = screen.getByTestId(`card-${cardId}`) as HTMLButtonElement;
      expect(btn).toBeDefined();
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.disabled).toBe(false);
    }
    // hand-count reflects array length.
    expect(screen.getByTestId('hand-count').textContent).toBe(String(CARDS.length));
  });

  it('click dispatches { type:"PlayCard", cardId, target:undefined } with current version', async () => {
    const postAction = vi.fn().mockResolvedValueOnce({
      state: makeState('STUB42', CARDS.slice(1), { version: 8 }),
      version: 8,
    });
    const api: GameApi = {
      getGame: vi.fn().mockResolvedValue({
        state: makeState('STUB42', CARDS, { version: 7 }),
        seat: 1 as Seat,
      }),
      createGame: vi.fn(),
      joinGame: vi.fn(),
      postAction,
    };
    seedMembership('STUB42', makeState('STUB42', CARDS, { version: 7 }));

    render(
      <GameApiProvider api={api}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );

    fireEvent.click(screen.getByTestId(`card-${CARDS[0]!}`));

    await waitFor(() => {
      expect(postAction).toHaveBeenCalledTimes(1);
    });
    const [arg] = postAction.mock.calls[0] as [
      Parameters<GameApi['postAction']>[0],
    ];
    expect(arg.action).toEqual({
      type: 'PlayCard',
      cardId: CARDS[0],
      target: undefined,
    });
    expect(arg.expectedVersion).toBe(7);
  });

  it('cards are disabled when it is not your turn', () => {
    seedMembership(
      'STUB42',
      makeState('STUB42', CARDS, { activePlayer: 2 }),
    );
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    for (const cardId of CARDS) {
      const btn = screen.getByTestId(`card-${cardId}`) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    }
  });

  it('cards are disabled outside mobilization / deployment phases', () => {
    seedMembership(
      'STUB42',
      makeState('STUB42', CARDS, { phase: 'start' }),
    );
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    for (const cardId of CARDS) {
      const btn = screen.getByTestId(`card-${cardId}`) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    }
  });

  it('cards are clickable in the deployment phase', () => {
    seedMembership(
      'STUB42',
      makeState('STUB42', CARDS, { phase: 'deployment' }),
    );
    render(
      <GameApiProvider api={new MockGameApi()}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );
    const btn = screen.getByTestId(`card-${CARDS[0]!}`) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('retries postAction once after a 409 with the refetched version', async () => {
    const postAction = vi
      .fn()
      .mockRejectedValueOnce(new VersionMismatchError(5, 0, 'stale'))
      .mockResolvedValueOnce({
        state: makeState('STUB42', CARDS.slice(1), { version: 6 }),
        version: 6,
      });
    const getGame = vi.fn().mockResolvedValue({
      state: makeState('STUB42', CARDS, { version: 5 }),
      seat: 1 as Seat,
    });
    const api: GameApi = {
      getGame,
      createGame: vi.fn(),
      joinGame: vi.fn(),
      postAction,
    };
    seedMembership('STUB42', makeState('STUB42', CARDS, { version: 0 }));

    render(
      <GameApiProvider api={api}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );

    fireEvent.click(screen.getByTestId(`card-${CARDS[0]!}`));

    await waitFor(() => {
      expect(postAction).toHaveBeenCalledTimes(2);
    });
    const [secondCall] = postAction.mock.calls[1] as [
      Parameters<GameApi['postAction']>[0],
    ];
    expect(secondCall.expectedVersion).toBe(5);
    expect(secondCall.action).toEqual({
      type: 'PlayCard',
      cardId: CARDS[0],
      target: undefined,
    });
    await waitFor(() => {
      expect(useSession.getState().currentGameState?.version).toBe(6);
    });
  });

  it('surfaces engine InvalidActionError (e.g. card_not_in_hand) via action-error', async () => {
    const postAction = vi
      .fn()
      .mockRejectedValueOnce(
        new InvalidActionError('card_not_in_hand', 'Card not in hand'),
      );
    const api: GameApi = {
      getGame: vi.fn().mockResolvedValue({
        state: makeState('STUB42', CARDS, { version: 7 }),
        seat: 1 as Seat,
      }),
      createGame: vi.fn(),
      joinGame: vi.fn(),
      postAction,
    };
    seedMembership('STUB42', makeState('STUB42', CARDS, { version: 7 }));

    render(
      <GameApiProvider api={api}>
        <Lobby gameCode="STUB42" />
      </GameApiProvider>,
    );

    fireEvent.click(screen.getByTestId(`card-${CARDS[0]!}`));

    await waitFor(() => {
      const err = screen.getByTestId('action-error');
      expect(err).toBeDefined();
      expect(err.textContent ?? '').toMatch(/card_not_in_hand|not in hand/i);
    });
  });
});
