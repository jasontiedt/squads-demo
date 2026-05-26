import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Action, CardId, Civ, Coord, UnitInstance } from '@eoe/schema';
import { loadCivMeta } from '@eoe/assets-meta';
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
import { Board } from '../components/board/Board.js';
import { ResourceBank } from '../components/hud/ResourceBank.js';
import { TurnIndicator } from '../components/hud/TurnIndicator.js';
import { WinnerBanner } from '../components/hud/WinnerBanner.js';
import {
  computeAttackUnitTargets,
  computeAvailableAttackModes,
  computeDeployTargets,
  computeMoveTargets,
  computeScoutTargets,
  coordKey,
} from '../lib/legalTargets.js';

export interface LobbyProps {
  gameCode: string;
}

/** Polling cadence for `GET /games/:code`. */
const POLL_INTERVAL_MS = 2000;

/** How long an error toast lingers before auto-dismissing. */
const TOAST_TTL_MS = 4000;

// ─────────────────────────── Selection state machine (Issue #70) ────
//
// The interactive board needs ONE source of truth for "what is the user
// in the middle of doing?" — clicking a unit, picking a target, picking
// a deploy square. We keep the machine flat (no nested modes) so the
// transitions are easy to reason about and easy to test.
//
//   idle
//     │
//     │  click own unit ────────►  unit-selected (mode: 'move'|'attack-melee'|'attack-ranged'|'scout')
//     │  click own card ────────►  card-selected (cardId)
//     │
//   unit-selected
//     │  click target square ───►  dispatch + back to idle
//     │  click target unit ─────►  dispatch + back to idle
//     │  Esc / right-click ─────►  idle
//     │  cycle action mode ─────►  unit-selected (next mode)
//     │
//   card-selected
//     │  click capital square ──►  dispatch DeployUnit + idle
//     │  Esc / right-click ─────►  idle
//
// "Action mode" for a selected unit defaults to 'move'. The UI offers
// buttons to switch into Attack (melee/ranged depending on availability)
// or Scout, so the user can pick what to do with that unit.

type ActionMode = 'move' | 'attack-melee' | 'attack-ranged' | 'scout';

type SelectionState =
  | { kind: 'idle' }
  | { kind: 'unit-selected'; unitId: string; mode: ActionMode }
  | { kind: 'card-selected'; cardId: string };

type SelectionEvent =
  | { type: 'clear' }
  | { type: 'select-unit'; unitId: string; mode: ActionMode }
  | { type: 'select-card'; cardId: string }
  | { type: 'set-mode'; mode: ActionMode };

const initialSelection: SelectionState = { kind: 'idle' };

const selectionReducer = (
  s: SelectionState,
  ev: SelectionEvent,
): SelectionState => {
  switch (ev.type) {
    case 'clear':
      return { kind: 'idle' };
    case 'select-unit':
      return { kind: 'unit-selected', unitId: ev.unitId, mode: ev.mode };
    case 'select-card':
      return { kind: 'card-selected', cardId: ev.cardId };
    case 'set-mode':
      if (s.kind !== 'unit-selected') return s;
      return { ...s, mode: ev.mode };
  }
};

export const Lobby = ({ gameCode }: LobbyProps): JSX.Element => {
  const api = useGameApi();
  const membership = useSession((st) => selectMembership(st, gameCode));
  const currentGameCode = useSession((st) => st.currentGameCode);
  const currentGameState = useSession((st) => st.currentGameState);
  const pollState = useSession((st) => st.pollState);
  const storeError = useSession((st) => st.error);
  const setCurrentGame = useSession((st) => st.setCurrentGame);
  const setPollState = useSession((st) => st.setPollState);
  const leaveGame = useSession((st) => st.leaveGame);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [selection, dispatchSelection] = useReducer(
    selectionReducer,
    initialSelection,
  );

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

  const fetchRef = useRef(fetchOnce);
  fetchRef.current = fetchOnce;

  useEffect(() => {
    if (!membership) return;
    let cancelled = false;

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

  /** Post an action with one 409 retry. */
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
          if (!fresh) return;
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

  // ─── Auto-dismiss error toast ──────────────────────────────────
  useEffect(() => {
    if (actionError === null) return;
    const id = window.setTimeout(
      () => setActionError(null),
      TOAST_TTL_MS,
    );
    return () => window.clearTimeout(id);
  }, [actionError]);

  /** Clear selection (Esc / right-click / dispatched action). MUST be
   *  declared before any conditional return to preserve hook order. */
  const clearSelection = useCallback(() => {
    dispatchSelection({ type: 'clear' });
  }, []);

  // ─── No membership: short-circuit render ──────────────────────
  if (!membership) {
    return (
      <main className="lobby">
        <h1>Game {gameCode}</h1>
        <p role="alert" className="error">
          You don't have a player token for this game in this browser.
        </p>
        <button onClick={() => navigate({ name: 'home' })}>Back to home</button>
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
  const ownHand = state?.players[membership.seat]?.hand;
  const handCount = Array.isArray(ownHand)
    ? ownHand.length
    : ownHand !== undefined && !Array.isArray(ownHand)
      ? (ownHand as { readonly count: number }).count
      : 0;
  const cardsClickable =
    !buttonsDisabled &&
    state !== null &&
    (state.phase === 'mobilization' || state.phase === 'deployment');

  // ─── Legal-target computation (Issue #70) ──────────────────────
  //
  // Everything below `state !== null` is in a render where we have
  // both the state and the user's membership. We compute the legal
  // target sets here so the Board gets a fresh snapshot every render
  // (state changes flow through poll → store → re-render).
  //
  // The Worker re-validates; this is UI pre-filtering only.

  let legalTargets: ReadonlySet<string> = new Set();
  let legalTargetUnitIds: ReadonlySet<string> = new Set();
  let availableModes: ReadonlySet<'melee' | 'ranged'> = new Set();
  let selectedUnit: UnitInstance | undefined;

  if (state !== null && yourTurn) {
    const civ: Civ = membership.civ;
    if (selection.kind === 'unit-selected') {
      selectedUnit = state.units.find((u) => u.id === selection.unitId);
      if (selectedUnit !== undefined && selectedUnit.owner === membership.seat) {
        availableModes = computeAvailableAttackModes(state, selectedUnit, civ);
        switch (selection.mode) {
          case 'move':
            legalTargets = computeMoveTargets(state, selectedUnit, civ);
            break;
          case 'attack-melee':
            legalTargetUnitIds = computeAttackUnitTargets(
              state,
              selectedUnit,
              civ,
              'melee',
            );
            break;
          case 'attack-ranged':
            legalTargetUnitIds = computeAttackUnitTargets(
              state,
              selectedUnit,
              civ,
              'ranged',
            );
            break;
          case 'scout':
            legalTargets = computeScoutTargets(state, selectedUnit);
            break;
        }
      }
    } else if (selection.kind === 'card-selected') {
      legalTargets = computeDeployTargets(state, membership.seat);
    }
  }

  // ─── Click handlers ─────────────────────────────────────────────

  /** Click on any unit marker. */
  const handleUnitClick = (u: UnitInstance): void => {
    if (state === null || !yourTurn || actionInFlight) return;

    // If user clicks an own unit while idle → select it (default mode: move).
    if (u.owner === membership.seat) {
      // Clicking the already-selected unit toggles selection off.
      if (
        selection.kind === 'unit-selected' &&
        selection.unitId === u.id
      ) {
        clearSelection();
        return;
      }
      dispatchSelection({
        type: 'select-unit',
        unitId: u.id,
        mode: 'move',
      });
      return;
    }

    // Clicking an enemy unit: if we're in an Attack mode and the unit
    // is a legal target, dispatch. Otherwise ignore.
    if (
      selection.kind === 'unit-selected' &&
      (selection.mode === 'attack-melee' || selection.mode === 'attack-ranged')
    ) {
      if (!legalTargetUnitIds.has(u.id)) return;
      const mode: 'melee' | 'ranged' =
        selection.mode === 'attack-melee' ? 'melee' : 'ranged';
      const attacker = state.units.find((x) => x.id === selection.unitId);
      if (attacker === undefined) return;
      clearSelection();
      void dispatchAction({
        type: 'Attack',
        attackerUnitId: attacker.id,
        targetUnitId: u.id,
        mode,
      });
    }
  };

  /** Click on any board square. */
  const handleSquareClick = (c: Coord): void => {
    if (state === null || !yourTurn || actionInFlight) return;
    const key = coordKey(c);

    if (selection.kind === 'unit-selected') {
      if (!legalTargets.has(key)) return;
      const unit = state.units.find((u) => u.id === selection.unitId);
      if (unit === undefined) return;

      if (selection.mode === 'move') {
        clearSelection();
        void dispatchAction({
          type: 'MoveUnit',
          unitId: unit.id,
          from: { x: unit.square.x, y: unit.square.y },
          to: { x: c.x, y: c.y },
        });
      } else if (selection.mode === 'scout') {
        clearSelection();
        void dispatchAction({
          type: 'Scout',
          unitId: unit.id,
          target: { x: c.x, y: c.y },
        });
      }
      return;
    }

    if (selection.kind === 'card-selected') {
      if (!legalTargets.has(key)) return;
      const cardId = selection.cardId as CardId;
      clearSelection();
      void dispatchAction({
        type: 'DeployUnit',
        cardId,
        square: { x: c.x, y: c.y },
      });
    }
  };

  /** Click on a card in the hand strip. Behavior depends on card kind:
   *  - `unit` cards → enter Deploy mode (select-card, wait for capital
   *    square click → DeployUnit).
   *  - All other kinds (tactic / action / event / upgrade / technology)
   *    and cards not in the catalog → dispatch `PlayCard` directly
   *    (target: undefined; rules engine validates).  */
  const handleCardClick = (cardId: string): void => {
    if (!cardsClickable || state === null) return;

    // Look up the card in the actor's civ catalog to determine kind.
    const civ: Civ = membership.civ;
    const catalog = loadCivMeta(civ);
    const card = catalog.find((c) => c.id === cardId);

    if (card !== undefined && card.kind === 'unit') {
      // Deploy flow: stash card selection, wait for square click.
      if (selection.kind === 'card-selected' && selection.cardId === cardId) {
        clearSelection();
        return;
      }
      dispatchSelection({ type: 'select-card', cardId });
      return;
    }

    // Non-unit (or unknown) card → dispatch PlayAction immediately
    // (typed action-card play, replaced generic PlayCard in #85).
    // NOTE: kinds other than `action` will be rejected by the rules
    // engine; UI for tactic/event/upgrade/technology lands in MVP-6.
    clearSelection();
    void dispatchAction({
      type: 'PlayAction',
      cardId: cardId as CardId,
    });
  };

  /** Action-mode buttons (Move / Attack / Scout) only meaningful when a
   *  friendly unit is selected. */
  const setActionMode = (mode: ActionMode): void => {
    if (selection.kind !== 'unit-selected') return;
    dispatchSelection({ type: 'set-mode', mode });
  };

  return (
    <main
      className="lobby"
      data-testid="lobby"
      data-version={state?.version ?? 0}
      data-seat={membership.seat}
      data-active-player={state?.activePlayer ?? 0}
      data-your-turn={yourTurn ? 'true' : 'false'}
      data-selection-kind={selection.kind}
    >
      <header className="lobby-header">
        <h1 data-testid="game-code">Game {gameCode}</h1>
        <button onClick={handleLeave} className="leave-btn">
          Leave game
        </button>
      </header>
      {state && (
        <TurnIndicator
          activePlayer={state.activePlayer}
          phase={state.phase}
          viewerSeat={membership.seat}
        />
      )}
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
            {Array.isArray(ownHand)
              ? ownHand.map((cardId) => {
                  const isSelected =
                    selection.kind === 'card-selected' &&
                    selection.cardId === cardId;
                  return (
                    <li key={cardId} className="hand-tile">
                      <button
                        type="button"
                        data-testid={`card-${cardId}`}
                        data-selected={isSelected ? 'true' : 'false'}
                        className={`hand-card-btn${isSelected ? ' selected' : ''}`}
                        disabled={!cardsClickable}
                        aria-pressed={isSelected}
                        aria-label={`Play card ${cardId}`}
                        onClick={() => handleCardClick(cardId)}
                      >
                        {cardId}
                      </button>
                    </li>
                  );
                })
              : Array.from({ length: handCount }, (_, i) => (
                  <li key={i} className="hand-tile" aria-label="Face-down card">
                    <span className="hand-tile-back">🂠</span>
                  </li>
                ))}
            {handCount === 0 && (
              <li className="hand-empty">No cards in hand.</li>
            )}
          </ul>
        </section>
      )}

      {/* Selection HUD: only renders when a unit is selected, gives the
          user the action-mode toggle (Move / Attack melee / Attack
          ranged / Scout) and a Cancel. */}
      {state && selection.kind === 'unit-selected' && selectedUnit && (
        <section
          className="selection-hud"
          aria-label="Unit action picker"
          data-testid="selection-hud"
          data-selected-unit={selectedUnit.id}
          data-action-mode={selection.mode}
        >
          <span className="selection-hud-label">
            Selected unit <code>{selectedUnit.id}</code> —
          </span>
          <button
            type="button"
            data-testid="action-mode-move"
            aria-pressed={selection.mode === 'move'}
            onClick={() => setActionMode('move')}
          >
            Move
          </button>
          {availableModes.has('melee') && (
            <button
              type="button"
              data-testid="action-mode-attack-melee"
              aria-pressed={selection.mode === 'attack-melee'}
              onClick={() => setActionMode('attack-melee')}
            >
              Attack (melee)
            </button>
          )}
          {availableModes.has('ranged') && (
            <button
              type="button"
              data-testid="action-mode-attack-ranged"
              aria-pressed={selection.mode === 'attack-ranged'}
              onClick={() => setActionMode('attack-ranged')}
            >
              Attack (ranged)
            </button>
          )}
          <button
            type="button"
            data-testid="action-mode-scout"
            aria-pressed={selection.mode === 'scout'}
            onClick={() => setActionMode('scout')}
          >
            Scout
          </button>
          <button
            type="button"
            data-testid="action-mode-cancel"
            onClick={clearSelection}
          >
            Cancel
          </button>
        </section>
      )}

      <section className="actions" aria-label="Your actions">
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

      {/* Transient toast above the board for action errors. Same data
          source as `action-error` above (which existing tests assert
          against) — the toast is purely a visual layer. */}
      {state && actionError && (
        <div
          role="status"
          className="board-toast"
          data-testid="board-toast"
        >
          {actionError}
        </div>
      )}

      {state && (
        <Board
          state={state}
          selectedUnitId={
            selection.kind === 'unit-selected' ? selection.unitId : undefined
          }
          legalTargets={legalTargets}
          legalTargetUnitIds={legalTargetUnitIds}
          onSquareClick={handleSquareClick}
          onUnitClick={handleUnitClick}
          onClearSelection={clearSelection}
        />
      )}

      {state && (
        <section
          className="resource-banks"
          aria-label="Resource banks"
          data-testid="resource-banks"
        >
          {([1, 2, 3, 4] as const).map((seat) => {
            const player = state.players[seat];
            if (player === undefined) return null;
            const isViewer = seat === membership.seat;
            return (
              <ResourceBank
                key={seat}
                player={player}
                label={isViewer ? 'You' : `Seat ${seat}`}
              />
            );
          })}
        </section>
      )}

      {state && state.phase === 'ended' && state.winner !== undefined && (
        <WinnerBanner
          gameCode={gameCode}
          winner={state.winner}
          viewerSeat={membership.seat}
        />
      )}
    </main>
  );
};
