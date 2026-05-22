// Session store — owns the user's per-game memberships (gameCode →
// {playerToken, seat, civ, name}) plus runtime UI state (pollState,
// last-fetched gameState, current route's game).
//
// Persistence: only `games` is written to localStorage under
// `eoe:active-game` (version 1). Runtime state is in-memory only —
// it must be re-fetched after reload.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Civ, GameId, PlayerToken, Seat } from '@eoe/schema';
import type { PublicGameState } from '../api/client.js';

export interface GameMembership {
  playerToken: PlayerToken;
  seat: Seat;
  civ: Civ;
  name: string;
}

/**
 * UI poll/request state machine.
 *  - `idle`     — no in-flight request.
 *  - `joining`  — a join request is in flight.
 *  - `creating` — a create request is in flight.
 *  - `active`   — last fetch succeeded, game is open.
 *  - `error`    — last fetch failed; `error` is set.
 */
export type PollState = 'idle' | 'joining' | 'creating' | 'active' | 'error';

export interface SessionState {
  // ── Persisted ────────────────────────────────────────────────────
  /** All games this browser has a token for, keyed by gameCode. */
  games: Record<string, GameMembership>;

  // ── Runtime only (not persisted) ─────────────────────────────────
  pollState: PollState;
  error: string | null;
  /** The game the user is currently looking at (matches URL). */
  currentGameCode: GameId | null;
  /** Most recently fetched server state for `currentGameCode`. */
  currentGameState: PublicGameState | null;

  // ── Actions ──────────────────────────────────────────────────────
  setMembership: (gameCode: GameId, membership: GameMembership) => void;
  setCurrentGame: (
    gameCode: GameId | null,
    state: PublicGameState | null,
  ) => void;
  setPollState: (state: PollState, error?: string | null) => void;
  leaveGame: (gameCode: GameId) => void;
  reset: () => void;
}

export const PERSIST_KEY = 'eoe:active-game';
export const PERSIST_VERSION = 1;

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      games: {},
      pollState: 'idle',
      error: null,
      currentGameCode: null,
      currentGameState: null,

      setMembership: (gameCode, membership) =>
        set((s) => ({ games: { ...s.games, [gameCode]: membership } })),

      setCurrentGame: (gameCode, state) =>
        set({ currentGameCode: gameCode, currentGameState: state }),

      setPollState: (pollState, error = null) =>
        set({ pollState, error: error ?? null }),

      leaveGame: (gameCode) =>
        set((s) => {
          const nextGames: Record<string, GameMembership> = {};
          for (const [k, v] of Object.entries(s.games)) {
            if (k !== gameCode) nextGames[k] = v;
          }
          const clearingCurrent = s.currentGameCode === gameCode;
          return {
            games: nextGames,
            ...(clearingCurrent
              ? {
                  currentGameCode: null,
                  currentGameState: null,
                  pollState: 'idle' as const,
                  error: null,
                }
              : {}),
          };
        }),

      reset: () =>
        set({
          games: {},
          currentGameCode: null,
          currentGameState: null,
          pollState: 'idle',
          error: null,
        }),
    }),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Only persist memberships. Runtime UI state is volatile.
      partialize: (s) => ({ games: s.games }),
    },
  ),
);

/** Selector helper — returns the membership for a code or null. */
export const selectMembership = (
  s: SessionState,
  gameCode: string | null,
): GameMembership | null => {
  if (!gameCode) return null;
  return s.games[gameCode] ?? null;
};
