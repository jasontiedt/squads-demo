import { useEffect } from 'react';
import { useSession, selectMembership } from '../store/session.js';
import { useGameApi } from '../api/context.js';
import { ApiError } from '../api/client.js';
import { navigate } from '../router/hash.js';

export interface LobbyProps {
  gameCode: string;
}

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

  // After reload, membership lives in localStorage but currentGameState is
  // empty — fetch the latest state on mount when we have a token but no state
  // for this code yet. (Real polling lands in #15.)
  useEffect(() => {
    if (!membership) return;
    if (currentGameCode === gameCode && currentGameState !== null) return;
    let cancelled = false;
    (async () => {
      setPollState('joining');
      try {
        const res = await api.getGame({
          gameCode,
          playerToken: membership.playerToken,
        });
        if (cancelled) return;
        setCurrentGame(gameCode, res.state);
        setPollState('active');
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof ApiError ? err.message : 'unknown error';
        setPollState('error', msg);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameCode, membership?.playerToken]);

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

  const state =
    currentGameCode === gameCode && currentGameState !== null
      ? currentGameState
      : null;

  const handleLeave = (): void => {
    leaveGame(gameCode);
    navigate({ name: 'home' });
  };

  return (
    <main className="lobby">
      <header className="lobby-header">
        <h1>Game {gameCode}</h1>
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
            <dd>{state.phase}</dd>
            <dt>Active player</dt>
            <dd>
              seat {state.activePlayer}
              {state.activePlayer === membership.seat
                ? ' — your turn'
                : ''}
            </dd>
            <dt>Turn</dt>
            <dd>{state.turn}</dd>
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
      <section className="board-placeholder" aria-label="Game board">
        <p>Game UI lands in #15.</p>
      </section>
    </main>
  );
};
