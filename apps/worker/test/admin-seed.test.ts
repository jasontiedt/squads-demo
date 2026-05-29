// ─────────────────────────── POST /admin/games/:code/seed tests ─────
//
// Issue #103 (MVP-6 S7-A). Verifies the admin seed endpoint contract:
//   • auth: missing/wrong/unset secret → 403,
//   • happy path: writes both seats' deck + hand verbatim → 200,
//   • not_found: unknown gameCode → 404,
//   • game_started: state.moveLog non-empty → 409,
//   • invalid_body: schema mismatch → 400.

import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index.js';
import { gameKey, type StoredGame } from '../src/kv-store.js';
import { memoryKV, type MemoryKV } from './helpers/memory-kv.js';

const ADMIN_SECRET = 'test-admin-secret-abc123';

function buildEnv(opts?: { kv?: MemoryKV; adminSecret?: string | undefined }): {
  env: Env;
  kv: MemoryKV;
} {
  const games = opts?.kv ?? memoryKV();
  const env: Env = {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    GAMES: games as unknown as KVNamespace,
    ...(opts && 'adminSecret' in opts
      ? opts.adminSecret === undefined
        ? {}
        : { ADMIN_SECRET: opts.adminSecret }
      : { ADMIN_SECRET }),
  };
  return { env, kv: games };
}

async function call(env: Env, init: RequestInit & { url: string }): Promise<Response> {
  const { url, ...rest } = init;
  const req = new Request(url, rest);
  // @ts-expect-error — test stub for ExecutionContext
  return worker.fetch(req, env, {});
}

interface CreateResponse {
  readonly gameCode: string;
  readonly playerToken: string;
  readonly seat: 1;
}

async function setupJoinedGame(env: Env): Promise<string> {
  const createRes = await call(env, {
    url: 'http://example.com/games',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ playerName: 'Alice', civ: 'english' }),
  });
  const created = (await createRes.json()) as CreateResponse;
  await call(env, {
    url: `http://example.com/games/${created.gameCode}/join`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ playerName: 'Bob', civ: 'byzantines' }),
  });
  return created.gameCode;
}

function seedBody(): Record<string, unknown> {
  return {
    deckOrder: ['english:Longbowman', 'english:Pikeman'],
    opponentDeckOrder: ['byzantines:Cataphract'],
    hand: ['english:Castle', 'english:Trebuchet'],
    opponentHand: ['byzantines:Varangian'],
  };
}

function resourceSeeds() {
  return {
    seat1: [
      { id: 'tok-seat1-wild-1', kind: 'wild', exhausted: false },
      { id: 'tok-seat1-wild-2', kind: 'wild', exhausted: false },
      { id: 'tok-seat1-wild-3', kind: 'wild', exhausted: false },
    ],
    seat2: [{ id: 'tok-seat2-gold-1', kind: 'gold', exhausted: true }],
  };
}

function unitSeeds() {
  return {
    seat1: [
      {
        id: 'unit-seed-seat1-0',
        cardId: 'eng-welsh-infantry',
        square: { x: 4, y: 5 },
        exhausted: false,
        damage: 0,
        attackMode: 'melee',
        upgrades: [],
      },
    ],
    seat2: [
      {
        id: 'unit-seed-seat2-0',
        cardId: 'byz-tagmata',
        square: { x: 3, y: 5 },
        exhausted: true,
        damage: 1,
        attackMode: 'melee',
        upgrades: [],
      },
    ],
  };
}

async function seed(
  env: Env,
  code: string,
  headers: Record<string, string> = { 'X-Admin-Secret': ADMIN_SECRET },
  body: unknown = seedBody(),
): Promise<Response> {
  return call(env, {
    url: `http://example.com/admin/games/${code}/seed`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// ─────────────────────────── Auth ────────────────────────────────────

describe('POST /admin/games/:code/seed — auth', () => {
  it('returns 403 when the X-Admin-Secret header is missing', async () => {
    const { env } = buildEnv();
    const code = await setupJoinedGame(env);
    const res = await seed(env, code, {});
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden');
  });

  it('returns 403 when the X-Admin-Secret header is wrong', async () => {
    const { env } = buildEnv();
    const code = await setupJoinedGame(env);
    const res = await seed(env, code, { 'X-Admin-Secret': 'wrong-secret' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden');
  });

  it('returns 403 when ADMIN_SECRET is unset on the worker', async () => {
    const { env } = buildEnv({ adminSecret: undefined });
    const code = await setupJoinedGame(env);
    const res = await seed(env, code);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('forbidden');
  });
});

// ─────────────────────────── Lookup ──────────────────────────────────

describe('POST /admin/games/:code/seed — lookup', () => {
  it('returns 404 when the game does not exist', async () => {
    const { env } = buildEnv();
    const res = await seed(env, 'NOPE-1234');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });
});

// ─────────────────────────── Invariant ───────────────────────────────

describe('POST /admin/games/:code/seed — invariants', () => {
  it('returns 409 when the game has already started (moveLog non-empty)', async () => {
    const { env, kv } = buildEnv();
    const code = await setupJoinedGame(env);
    // Mutate stored state to inject one action-log entry.
    const stored = kv.peek<StoredGame>(gameKey(code));
    expect(stored).not.toBeNull();
    const dirty: StoredGame = {
      ...(stored as StoredGame),
      state: {
        ...(stored as StoredGame).state,
        moveLog: [
          {
            at: '2025-01-01T00:00:00.000Z',
            seat: 1,
            action: { type: 'EndTurn' },
          },
        ],
      },
    };
    await kv.put(gameKey(code), JSON.stringify(dirty));
    const res = await seed(env, code);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('game_started');
  });

  it('returns 409 when seat 2 has not yet joined', async () => {
    const { env } = buildEnv();
    const createRes = await call(env, {
      url: 'http://example.com/games',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ playerName: 'Alice', civ: 'english' }),
    });
    const created = (await createRes.json()) as CreateResponse;
    const res = await seed(env, created.gameCode);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_joined');
  });
});

// ─────────────────────────── Body validation ─────────────────────────

describe('POST /admin/games/:code/seed — body validation', () => {
  it('returns 400 when the body is not valid JSON', async () => {
    const { env } = buildEnv();
    const code = await setupJoinedGame(env);
    const res = await seed(env, code, { 'X-Admin-Secret': ADMIN_SECRET }, 'not-json{');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_json');
  });

  it('returns 400 when a required field is missing', async () => {
    const { env } = buildEnv();
    const code = await setupJoinedGame(env);
    const res = await seed(env, code, { 'X-Admin-Secret': ADMIN_SECRET }, {
      deckOrder: ['x'],
      hand: ['y'],
      opponentHand: ['z'],
      // opponentDeckOrder missing
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('returns 400 when an unknown field is present (strict)', async () => {
    const { env } = buildEnv();
    const code = await setupJoinedGame(env);
    const res = await seed(env, code, { 'X-Admin-Secret': ADMIN_SECRET }, {
      ...seedBody(),
      extra: 'nope',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });
});

// ─────────────────────────── Happy path ──────────────────────────────

describe('POST /admin/games/:code/seed — happy path', () => {
  it('overwrites both seats deck and hand and returns 200', async () => {
    const { env, kv } = buildEnv();
    const code = await setupJoinedGame(env);
    const body = seedBody();
    const res = await seed(env, code, { 'X-Admin-Secret': ADMIN_SECRET }, body);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { ok: boolean; version: number };
    expect(payload.ok).toBe(true);

    const stored = kv.peek<StoredGame>(gameKey(code));
    expect(stored).not.toBeNull();
    expect(stored?.state.players[1]?.deck).toEqual(body['deckOrder']);
    expect(stored?.state.players[1]?.hand).toEqual(body['hand']);
    expect(stored?.state.players[2]?.deck).toEqual(body['opponentDeckOrder']);
    expect(stored?.state.players[2]?.hand).toEqual(body['opponentHand']);
    // Did NOT advance the game (moveLog still empty, phase preserved).
    expect(stored?.state.moveLog).toEqual([]);
  });

  it('optionally seeds seat resources', async () => {
    const { env, kv } = buildEnv();
    const code = await setupJoinedGame(env);
    const body = { ...seedBody(), resources: resourceSeeds() };

    const res = await seed(env, code, { 'X-Admin-Secret': ADMIN_SECRET }, body);

    expect(res.status).toBe(200);
    const stored = kv.peek<StoredGame>(gameKey(code));
    expect(stored?.state.players[1]?.resources).toEqual(body.resources.seat1);
    expect(stored?.state.players[2]?.resources).toEqual(body.resources.seat2);
    expect(stored?.state.units).toEqual([]);
    expect(stored?.state.moveLog).toEqual([]);
  });

  it('optionally seeds deployed units with owner inferred from the seat bucket', async () => {
    const { env, kv } = buildEnv();
    const code = await setupJoinedGame(env);
    const body = { ...seedBody(), units: unitSeeds() };

    const res = await seed(env, code, { 'X-Admin-Secret': ADMIN_SECRET }, body);

    expect(res.status).toBe(200);
    const stored = kv.peek<StoredGame>(gameKey(code));
    expect(stored?.state.units).toEqual([
      { ...body.units.seat1[0], owner: 1 },
      { ...body.units.seat2[0], owner: 2 },
    ]);
    expect(stored?.state.moveLog).toEqual([]);
  });

  it('optionally seeds resources and deployed units together', async () => {
    const { env, kv } = buildEnv();
    const code = await setupJoinedGame(env);
    const body = {
      ...seedBody(),
      resources: resourceSeeds(),
      units: unitSeeds(),
    };

    const res = await seed(env, code, { 'X-Admin-Secret': ADMIN_SECRET }, body);

    expect(res.status).toBe(200);
    const stored = kv.peek<StoredGame>(gameKey(code));
    expect(stored?.state.players[1]?.resources).toEqual(body.resources.seat1);
    expect(stored?.state.players[2]?.resources).toEqual(body.resources.seat2);
    expect(stored?.state.units).toEqual([
      { ...body.units.seat1[0], owner: 1 },
      { ...body.units.seat2[0], owner: 2 },
    ]);
    expect(stored?.state.moveLog).toEqual([]);
  });

  it('is idempotent — calling twice with the same body yields the same stored state', async () => {
    const { env, kv } = buildEnv();
    const code = await setupJoinedGame(env);
    const body = seedBody();
    await seed(env, code, { 'X-Admin-Secret': ADMIN_SECRET }, body);
    const first = JSON.stringify(kv.peek<StoredGame>(gameKey(code)));
    await seed(env, code, { 'X-Admin-Secret': ADMIN_SECRET }, body);
    const second = JSON.stringify(kv.peek<StoredGame>(gameKey(code)));
    expect(second).toBe(first);
  });
});
