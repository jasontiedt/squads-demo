import { describe, it, expect, beforeEach } from 'vitest';
import {
  useSession,
  selectMembership,
  PERSIST_KEY,
  PERSIST_VERSION,
} from '../store/session.js';
import type { GameMembership } from '../store/session.js';
import type { PlayerToken } from '@eoe/schema';

const sampleMembership = (overrides: Partial<GameMembership> = {}): GameMembership => ({
  playerToken: ('a'.repeat(40)) as PlayerToken,
  seat: 1,
  civ: 'english',
  name: 'Lando',
  ...overrides,
});

describe('useSession store', () => {
  beforeEach(() => {
    useSession.setState({
      games: {},
      pollState: 'idle',
      error: null,
      currentGameCode: null,
      currentGameState: null,
    });
    localStorage.clear();
  });

  it('records a membership', () => {
    useSession.getState().setMembership('STUB01', sampleMembership());
    expect(useSession.getState().games['STUB01']).toEqual(sampleMembership());
  });

  it('persists memberships to localStorage under eoe:active-game', () => {
    useSession.getState().setMembership('STUB01', sampleMembership());
    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? '{}');
    expect(parsed.version).toBe(PERSIST_VERSION);
    expect(parsed.state.games.STUB01.seat).toBe(1);
  });

  it('does NOT persist runtime fields (pollState, currentGameState)', () => {
    useSession.getState().setPollState('joining');
    useSession.getState().setMembership('STUB02', sampleMembership());
    const parsed = JSON.parse(localStorage.getItem(PERSIST_KEY) ?? '{}');
    expect(parsed.state.pollState).toBeUndefined();
    expect(parsed.state.currentGameState).toBeUndefined();
  });

  it('rehydrates memberships when localStorage is pre-populated', async () => {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        version: PERSIST_VERSION,
        state: {
          games: { ABCD12: sampleMembership({ seat: 2, civ: 'byzantines' }) },
        },
      }),
    );
    // Force a rehydrate from the freshly-populated storage.
    await useSession.persist.rehydrate();
    expect(useSession.getState().games['ABCD12']?.seat).toBe(2);
    expect(useSession.getState().games['ABCD12']?.civ).toBe('byzantines');
  });

  it('leaveGame removes only the matching gameCode', () => {
    const s = useSession.getState();
    s.setMembership('STUB01', sampleMembership());
    s.setMembership('STUB02', sampleMembership({ seat: 2 }));
    useSession.getState().leaveGame('STUB01');
    const games = useSession.getState().games;
    expect(games['STUB01']).toBeUndefined();
    expect(games['STUB02']).toBeDefined();
  });

  it('leaveGame clears currentGame fields when leaving the active game', () => {
    const s = useSession.getState();
    s.setMembership('STUB01', sampleMembership());
    s.setCurrentGame('STUB01', null);
    useSession.setState({ currentGameCode: 'STUB01' });
    useSession.getState().leaveGame('STUB01');
    expect(useSession.getState().currentGameCode).toBeNull();
  });

  it('selectMembership returns null for unknown codes', () => {
    const s = useSession.getState();
    s.setMembership('STUB01', sampleMembership());
    expect(selectMembership(useSession.getState(), 'STUB01')?.name).toBe('Lando');
    expect(selectMembership(useSession.getState(), 'NOPE99')).toBeNull();
    expect(selectMembership(useSession.getState(), null)).toBeNull();
  });
});
