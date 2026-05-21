import { describe, it, expect } from 'vitest';
import { MockGameApi } from '../api/mock.js';
import { ApiError } from '../api/client.js';
import { RealGameApi } from '../api/real.js';

describe('MockGameApi', () => {
  it('createGame returns a gameCode + seat 1 + a long-enough token', async () => {
    const api = new MockGameApi();
    const res = await api.createGame({ name: 'Lando', civ: 'english' });
    expect(res.gameCode).toMatch(/^STUB\d{2}$/);
    expect(res.seat).toBe(1);
    expect(res.playerToken.length).toBeGreaterThanOrEqual(32);
    expect(res.state.gameId).toBe(res.gameCode);
  });

  it('nextGameCode override is honoured exactly once', async () => {
    const api = new MockGameApi({ nextGameCode: 'CUSTOM' });
    const first = await api.createGame({ name: 'A', civ: 'english' });
    const second = await api.createGame({ name: 'B', civ: 'byzantines' });
    expect(first.gameCode).toBe('CUSTOM');
    expect(second.gameCode).toMatch(/^STUB\d{2}$/);
  });

  it('joinGame assigns the next open seat (2) after a create', async () => {
    const api = new MockGameApi({ nextGameCode: 'ABCD' });
    await api.createGame({ name: 'A', civ: 'english' });
    const joined = await api.joinGame({
      gameCode: 'ABCD',
      name: 'B',
      civ: 'byzantines',
    });
    expect(joined.seat).toBe(2);
    expect(joined.gameCode).toBe('ABCD');
  });

  it('getGame returns the seat for the matching token', async () => {
    const api = new MockGameApi({ nextGameCode: 'WXYZ' });
    const c = await api.createGame({ name: 'A', civ: 'english' });
    const got = await api.getGame({
      gameCode: 'WXYZ',
      playerToken: c.playerToken,
    });
    expect(got.seat).toBe(1);
    expect(got.state.gameId).toBe('WXYZ');
  });

  it('getGame throws unauthorized for unknown token', async () => {
    const api = new MockGameApi({ nextGameCode: 'WXYZ' });
    await api.createGame({ name: 'A', civ: 'english' });
    await expect(
      api.getGame({
        gameCode: 'WXYZ',
        playerToken: 'z'.repeat(40) as never,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects empty name on createGame', async () => {
    const api = new MockGameApi();
    await expect(
      api.createGame({ name: '   ', civ: 'english' }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('RealGameApi', () => {
  it('throws not_implemented on every method (issue #13 will wire it)', async () => {
    const api = new RealGameApi('http://localhost:8787');
    await expect(api.createGame({ name: 'x', civ: 'english' })).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(
      api.joinGame({ gameCode: 'STUB01', name: 'x', civ: 'english' }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      api.getGame({ gameCode: 'STUB01', playerToken: 'z'.repeat(40) as never }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('strips trailing slashes from baseUrl', () => {
    const api = new RealGameApi('http://localhost:8787///');
    expect(api.baseUrl).toBe('http://localhost:8787');
  });
});
