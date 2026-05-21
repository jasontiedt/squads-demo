import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockGameApi } from '../api/mock.js';
import { RealGameApi } from '../api/real.js';
import {
  ApiError,
  AuthError,
  InvalidActionError,
  NotFoundError,
  VersionMismatchError,
  placeholderState,
} from '../api/client.js';
import type { PlayerToken } from '@eoe/schema';

const TOKEN = 'a'.repeat(40) as PlayerToken;

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

  it('getGame throws AuthError for unknown token', async () => {
    const api = new MockGameApi({ nextGameCode: 'WXYZ' });
    await api.createGame({ name: 'A', civ: 'english' });
    await expect(
      api.getGame({ gameCode: 'WXYZ', playerToken: TOKEN }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('getGame throws NotFoundError for unknown code', async () => {
    const api = new MockGameApi();
    await expect(
      api.getGame({ gameCode: 'NOPE99', playerToken: TOKEN }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects empty name on createGame', async () => {
    const api = new MockGameApi();
    await expect(
      api.createGame({ name: '   ', civ: 'english' }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('postAction bumps version on success', async () => {
    const api = new MockGameApi({ nextGameCode: 'ACTN01' });
    const c = await api.createGame({ name: 'A', civ: 'english' });
    const res = await api.postAction({
      gameCode: 'ACTN01',
      seat: c.seat,
      token: c.playerToken,
      expectedVersion: c.state.version,
      action: { type: 'EndPhase' },
    });
    expect(res.version).toBe(c.state.version + 1);
  });

  it('postAction throws VersionMismatchError with current+expected', async () => {
    const api = new MockGameApi({ nextGameCode: 'ACTN02' });
    const c = await api.createGame({ name: 'A', civ: 'english' });
    try {
      await api.postAction({
        gameCode: 'ACTN02',
        seat: c.seat,
        token: c.playerToken,
        expectedVersion: 99,
        action: { type: 'EndPhase' },
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(VersionMismatchError);
      const v = err as VersionMismatchError;
      expect(v.current).toBe(c.state.version);
      expect(v.expected).toBe(99);
    }
  });
});

describe('placeholderState', () => {
  it('returns a minimal state at version 0 with gameId set', () => {
    const s = placeholderState('STUB42');
    expect(s.gameId).toBe('STUB42');
    expect(s.version).toBe(0);
    expect(s.phase).toBe('mobilization');
  });
});

// -------------------------------------------------------------------------
// RealGameApi — real HTTP wiring via mocked global.fetch
// -------------------------------------------------------------------------

const fetchMock = vi.fn();

const okJson = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const errJson = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('RealGameApi', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('strips trailing slashes from baseUrl', () => {
    const api = new RealGameApi('http://localhost:8787///');
    expect(api.baseUrl).toBe('http://localhost:8787');
  });

  it('createGame POSTs /games then GETs state and returns full response', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({
          gameCode: 'ABCD12',
          playerToken: TOKEN,
          seat: 1,
        }),
      )
      .mockResolvedValueOnce(
        okJson({ state: placeholderState('ABCD12'), version: 0 }),
      );
    const api = new RealGameApi('http://localhost:8787');
    const res = await api.createGame({ name: 'Lando', civ: 'english' });
    expect(res.gameCode).toBe('ABCD12');
    expect(res.seat).toBe(1);
    expect(res.playerToken).toBe(TOKEN);
    expect(res.state.gameId).toBe('ABCD12');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [postUrl, postInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(postUrl).toBe('http://localhost:8787/games');
    expect(postInit.method).toBe('POST');
    expect(JSON.parse(String(postInit.body))).toEqual({
      playerName: 'Lando',
      civ: 'english',
    });
    const [getUrl, getInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(getUrl).toBe('http://localhost:8787/games/ABCD12');
    expect(getInit.method ?? 'GET').toBe('GET');
  });

  it('joinGame POSTs /games/:code/join then GETs state', async () => {
    fetchMock
      .mockResolvedValueOnce(
        okJson({ playerToken: TOKEN, seat: 2 }),
      )
      .mockResolvedValueOnce(
        okJson({ state: placeholderState('ABCD12'), version: 0 }),
      );
    const api = new RealGameApi('http://localhost:8787');
    const res = await api.joinGame({
      gameCode: 'ABCD12',
      name: 'Vader',
      civ: 'byzantines',
    });
    expect(res.seat).toBe(2);
    expect(res.gameCode).toBe('ABCD12');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:8787/games/ABCD12/join',
    );
  });

  it('getGame GETs /games/:code', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ state: placeholderState('ABCD12'), version: 0 }),
    );
    const api = new RealGameApi('http://localhost:8787');
    const res = await api.getGame({
      gameCode: 'ABCD12',
      playerToken: TOKEN,
    });
    expect(res.state.gameId).toBe('ABCD12');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:8787/games/ABCD12',
    );
  });

  it('postAction POSTs /games/:code/actions with version + seat + token', async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({ state: placeholderState('ABCD12'), version: 1 }),
    );
    const api = new RealGameApi('http://localhost:8787');
    const res = await api.postAction({
      gameCode: 'ABCD12',
      seat: 1,
      token: TOKEN,
      expectedVersion: 0,
      action: { type: 'EndPhase' },
    });
    expect(res.version).toBe(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8787/games/ABCD12/actions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      seat: 1,
      token: TOKEN,
      expectedVersion: 0,
      action: { type: 'EndPhase' },
    });
  });

  it('maps 401 to AuthError', async () => {
    fetchMock.mockResolvedValueOnce(
      errJson(401, { code: 'unauthorized', message: 'bad token' }),
    );
    const api = new RealGameApi('http://localhost:8787');
    await expect(
      api.getGame({ gameCode: 'ABCD12', playerToken: TOKEN }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('maps 404 to NotFoundError', async () => {
    fetchMock.mockResolvedValueOnce(
      errJson(404, { code: 'not_found', message: 'no such game' }),
    );
    const api = new RealGameApi('http://localhost:8787');
    await expect(
      api.getGame({ gameCode: 'NOPE99', playerToken: TOKEN }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps 409 to VersionMismatchError with current+expected', async () => {
    fetchMock.mockResolvedValueOnce(
      errJson(409, {
        code: 'version_mismatch',
        current: 5,
        expected: 3,
        message: 'stale',
      }),
    );
    const api = new RealGameApi('http://localhost:8787');
    try {
      await api.postAction({
        gameCode: 'ABCD12',
        seat: 1,
        token: TOKEN,
        expectedVersion: 3,
        action: { type: 'EndPhase' },
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(VersionMismatchError);
      const v = err as VersionMismatchError;
      expect(v.current).toBe(5);
      expect(v.expected).toBe(3);
    }
  });

  it('maps 400 to InvalidActionError preserving the rules-engine code', async () => {
    fetchMock.mockResolvedValueOnce(
      errJson(400, { code: 'not_your_turn', message: 'wait your turn' }),
    );
    const api = new RealGameApi('http://localhost:8787');
    try {
      await api.postAction({
        gameCode: 'ABCD12',
        seat: 2,
        token: TOKEN,
        expectedVersion: 0,
        action: { type: 'EndPhase' },
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidActionError);
      const e = err as InvalidActionError;
      expect(e.code).toBe('not_your_turn');
    }
  });

  it('wraps fetch network failures as ApiError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    const api = new RealGameApi('http://localhost:8787');
    await expect(
      api.getGame({ gameCode: 'ABCD12', playerToken: TOKEN }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
