import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action } from '@eoe/schema';
import { useSession, selectMembership } from '../store/session.js';
import { useGameApi } from '../api/context.js';
import {
  ApiError,
  AuthError,
  InvalidActionError,
  NotFoundError,
  VersionMismatchError,
  type PublicGameState,
} from '../api/client.js';
import { navigate } from '../router/hash.js';

export interface LobbyProps {
  gameCode: string;
}

/** Polling cadence for `GET /games/:code`. Kept short so the second
 *  player sees the host's actions land quickly without hammering the
 *  Worker — a future WebSocket subscription replaces this entirely. */
const POLL_INTERVAL_MS = 2000;

export const Lobby = ({ gameCode }: LobbyProps): JSX.Element => {
  const api = useGameApi();
  const membership = useSession((s) => selectMembership(s, gameCode));
  const currentGameCode = useSession((s) => s.currentGameCode);
  const currentGameState = useSession((s) => s.currentGameState);
  const pollState = useSession((s) => s.pollState);
  const storeError = useSession((s) => s.error);
  const setCurrentGame = useSession((s) => s.setCurrentGame);
  const setPollState = useSession((s) => s.setPollState);
  const leaveGame = useSession((s) => s.leaveGame);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);

  // The store reflects whatever the last fetch saw; for the rest of
  // this render the source of truth is the in-store state when it
  // matches the URL, or `null` until the first fetch completes.
  const state =
    currentGameCode === gameCode && currentGameState !== null
      ? currentGameState
      : null;

  /** Drop the membership and bounce home with an explanation. */
  const bounceWithError = useCallback(
    (message: string): void => {
      leaveGame(gameCode);
      setPollState('error', message);
      navigate({ name: 'home' });
    },
    [gameCode, leaveGame, setPollState],
  );

  /** Normalise an error from a worker call into either a UI message
   *  or a side-effect (navigation away). Returns the message to show
   *  if the caller should stay on this view, else null. */
  const handleApiError = useCallback(
    (err: unknown): string | null => {
      if (err instanceof AuthError) {
        bounceWithError('You were signed out of this game.');
        return null;
      }
      if (err instanceof NotFoundError) {
        bounceWithError(`Game ${gameCode} was not found.`);
        return null;
      }
      if (err instanceof InvalidActionError) {
        return `Rules engine rejected action (${err.code}).`;
      }
      if (err instanceof VersionMismatchError) {
        return `State moved on — please try again.`;
      }
      if (err instanceof ApiError) return err.message;
      return 'Unknown error';
    },
    [bounceWithError, gameCode],
  );

  /** Fetch state once. Returns the fetched state on success. */
  const fetchOnce = useCallback(async (): Promise<PublicGameState | null> => {
    if (!membership) return null;
    try {
      const res = await api.getGame({
        gameCode,
        playerToken: membership.playerToken,
      });
      setCurrentGame(gameCode, res.state);
      return res.state;
    } catch (err) {
      const msg = handleApiError(err);
      if (msg !== null) setPollState('error', msg);
      return null;
    }
  }, [api, gameCode, handleApiError, membership, setCurrentGame, setPollState]);

  // Initial-fetch + 2s polling.
  //
  // We avoid re-creating the interval when the in-memory state changes
  // — only the gameCode / token gate restarts polling. The interval
  // callback closes over the latest `fetchOnce` via a ref so it always
  // dispatches with current store data.
  const fetchRef = useRef(fetchOnce);
  fetchRef.current = fetchOnce;

  useEffect(() => {
    if (!membership) return;
    let cancelled = false;

    // If we already have fresh-looking state for this game (e.g. test
    // seed or just navigated from Home), skip the initial fetch — the
    // 2s poll will pick up any drift. Otherwise show "joining" while
    // we rehydrate from the worker.
    const hasState = state !== null && currentGameCode === gameCode;
    if (!hasState) {
      setPollState('joining');
      (async () => {
        const s = await fetchRef.current();
        if (cancelled) return;
        setPollState(s === null ? 'error' : 'active');
      })();
    } else {
      setPollState('active');
    }

    const id = window.setInterval(() => {
      if (cancelled) return;
      void fetchRef.current();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameCode, membership?.playerToken]);

  /** Post an action with one automatic 409 retry: on `version_mismatch`
   *  we refetch state via GET and re-issue the POST with the freshly
   *  observed version. A second 409 surfaces to the user. */
  const dispatchAction = useCallback(
    async (action: Action): Promise<void> => {
      if (!membership || !state) return;
      setActionError(null);
      setActionInFlight(true);
      try {
        const tryOnce = async (version: number) =>
          api.postAction({
            gameCode,
            seat: membership.seat,
            token: membership.playerToken,
            expectedVersion: version,
            action,
          });
        try {
          const res = await tryOnce(state.version);
          setCurrentGame(gameCode, res.state);
        } catch (err) {
          if (!(err instanceof VersionMismatchError)) throw err;
          const fresh = await fetchRef.current();
          if (!fresh) return; // fetchOnce already surfaced the error
          const res = await tryOnce(fresh.version);
          setCurrentGame(gameCode, res.state);
        }
      } catch (err) {
        const msg = handleApiError(err);
        if (msg !== null) setActionError(msg);
      } finally {
        setActionInFlight(false);
      }
    },
    [api, gameCode, handleApiError, membership, setCurrentGame, state],
  );

  if (!membership) {
    return (
      <main className="lobby">
        <h1>Game {gameCode}</h1>
        <p role="alert" className="error">
          You don't have a player token for this game in this browser.
        </p>
        <button onClick={() => navigate({ name: 'home' })}>
          Back to home
        </button>
      </main>
    );
  }

  const handleLeave = (): void => {
    leaveGame(gameCode);
    navigate({ name: 'home' });
  };

  const yourTurn =
    state !== null && state.activePlayer === membership.seat;
  const buttonsDisabled = !state || !yourTurn || actionInFlight;
  const handCount = state?.players[membership.seat]?.hand.count ?? 0;

  return (
    <main
      className="lobby"
      data-testid="lobby"
      data-version={state?.version ?? 0}
      data-seat={membership.seat}
      data-active-player={state?.activePlayer ?? 0}
      data-your-turn={yourTurn ? 'true' : 'false'}
    >
      <header className="lobby-header">
        <h1 data-testid="game-code">Game {gameCode}</h1>
        <button onClick={handleLeave} className="leave-btn">
          Leave game
        </button>
      </header>
      <dl className="lobby-info">
        <dt>You are</dt>
        <dd>
          {membership.name} — seat <strong>{membership.seat}</strong> (
          {membership.civ})
        </dd>
        {state ? (
          <>
            <dt>Phase</dt>
            <dd data-testid="phase">{state.phase}</dd>
            <dt>Active player</dt>
            <dd data-testid="active-player">
              seat {state.activePlayer}
              {yourTurn ? ' — your turn' : ''}
            </dd>
            <dt>Turn</dt>
            <dd data-testid="turn">{state.turn}</dd>
          </>
        ) : (
          <>
            <dt>Status</dt>
            <dd>
              {pollState === 'error'
                ? `Error: ${storeError ?? 'unknown'}`
                : 'Loading game state…'}
            </dd>
          </>
        )}
      </dl>

      {state && (
        <section className="hand" aria-label="Your hand">
          <h2>
            Your hand — <span data-testid="hand-count">{handCount}</span> card
            {handCount === 1 ? '' : 's'}
          </h2>
          <ul className="hand-tiles" role="list">
            {Array.from({ length: handCount }, (_, i) => (
              <li key={i} className="hand-tile" aria-label="Face-down card">
                {/* Card contents stay opaque on the wire — the server
                    redacts every player's hand. */}
                <span className="hand-tile-back">🂠</span>
              </li>
            ))}
            {handCount === 0 && (
              <li className="hand-empty">No cards in hand.</li>
            )}
          </ul>
        </section>
      )}

      <section className="actions" aria-label="Your actions">
        <button
          type="button"
          disabled
          title="Play card lands once @eoe/rules has a PlayCard action"
        >
          Play card
        </button>
        <button
          type="button"
          data-testid="end-phase-btn"
          disabled={buttonsDisabled}
          onClick={() => void dispatchAction({ type: 'EndPhase' })}
        >
          End phase
        </button>
        <button
          type="button"
          data-testid="end-turn-btn"
          disabled={buttonsDisabled}
          onClick={() => void dispatchAction({ type: 'EndTurn' })}
        >
          End turn
        </button>
        {actionError && (
          <p role="alert" className="error" data-testid="action-error">
            {actionError}
          </p>
        )}
      </section>

      <section className="board-placeholder" aria-label="Game board">
        <p>Board view lands in a follow-up issue.</p>
      </section>
    </main>
  );
};
