// ─────────────────────────── POST /admin/games/:code/seed ───────────
//
// Issue #103 (MVP-6 S7-A): admin-only endpoint that overwrites both
// seats' decks (in order) and opening hands BEFORE any action has
// been applied. Used by Playwright e2e suites to make card draw
// deterministic without poking at engine internals.
//
// Auth: `X-Admin-Secret` request header must equal `env.ADMIN_SECRET`.
// When `env.ADMIN_SECRET` is unset/empty the endpoint refuses ALL
// callers — production deploys that omit the secret binding intentionally
// disable the route.
//
// Safety invariant: the game's `moveLog` MUST be empty. Seeding after
// play has started would corrupt history (cards already drawn would
// vanish from hands, units already deployed would have orphan card
// references). On non-empty log we return 409 — clients re-create the
// game and re-seed.

import { errorBody, json } from '../http.js';
import { loadGame, saveGame } from '../kv-store.js';
import { AdminSeedBody } from '../request-schema.js';
import { type CardId, type UnitInstance } from '@eoe/schema';

export async function handleAdminSeed(
  request: Request,
  kv: KVNamespace,
  gameCode: string,
  adminSecret: string | undefined,
  cors: HeadersInit,
): Promise<Response> {
  // 1) Gate. Missing/empty secret binding → blanket refusal. The
  //    `X-Admin-Secret` header MUST be present AND match the binding
  //    exactly. Constant-time comparison isn't worth it for a secret
  //    that's a long random token (timing leaks bits of equality
  //    structure, not the secret itself at MVP scale).
  if (adminSecret === undefined || adminSecret.length === 0) {
    return json(errorBody('forbidden', 'Admin seed is disabled.'), 403, cors);
  }
  const presented = request.headers.get('X-Admin-Secret');
  if (presented === null || presented !== adminSecret) {
    return json(errorBody('forbidden', 'Invalid admin secret.'), 403, cors);
  }

  // 2) Body. Zod-validate at the edge — strict object, four required
  //    string[] fields.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(errorBody('invalid_json', 'Request body must be valid JSON.'), 400, cors);
  }
  const parsed = AdminSeedBody.safeParse(raw);
  if (!parsed.success) {
    return json(
      errorBody('invalid_body', 'Request body failed validation.', parsed.error.flatten()),
      400,
      cors,
    );
  }
  const { deckOrder, opponentDeckOrder, hand, opponentHand, resources, units } = parsed.data;

  // 3) Lookup.
  const stored = await loadGame(kv, gameCode);
  if (stored === null) {
    return json(errorBody('not_found', `No game with code ${gameCode}.`), 404, cors);
  }

  // 4) Invariant: action log empty → seed is safe. Otherwise refuse.
  if (stored.state.moveLog.length > 0) {
    return json(
      errorBody(
        'game_started',
        'Cannot seed: game already has applied actions.',
      ),
      409,
      cors,
    );
  }

  // 5) Both seats must already exist. Seeding seat B before join would
  //    leave half a player object behind; we refuse rather than invent
  //    a player record here.
  const seatA = stored.state.players[1];
  const seatB = stored.state.players[2];
  if (seatA === undefined || seatB === undefined) {
    return json(
      errorBody(
        'not_joined',
        'Cannot seed: both seats must be joined before seeding.',
      ),
      409,
      cors,
    );
  }

  const existingSeat1Units = stored.state.units.filter((unit) => unit.owner === 1);
  const existingSeat2Units = stored.state.units.filter((unit) => unit.owner === 2);
  const existingOtherUnits = stored.state.units.filter((unit) => unit.owner !== 1 && unit.owner !== 2);
  const nextUnits: UnitInstance[] = [
    ...(units?.seat1?.map((unit) => ({ ...unit, owner: 1 as const })) ?? existingSeat1Units),
    ...(units?.seat2?.map((unit) => ({ ...unit, owner: 2 as const })) ?? existingSeat2Units),
    ...existingOtherUnits,
  ];

  // 6) Mutate. CardId is a branded string at the type layer; the body
  //    arrives as plain strings, cast at the boundary. The rules engine
  //    does not validate card existence on draw — invalid ids surface
  //    later as engine errors, which is fine for a deliberately powerful
  //    test endpoint.
  const nextState = {
    ...stored.state,
    players: {
      ...stored.state.players,
      1: {
        ...seatA,
        deck: deckOrder as CardId[],
        hand: hand as CardId[],
        resources: resources?.seat1 ?? seatA.resources,
      },
      2: {
        ...seatB,
        deck: opponentDeckOrder as CardId[],
        hand: opponentHand as CardId[],
        resources: resources?.seat2 ?? seatB.resources,
      },
    },
    units: nextUnits,
  };

  await saveGame(kv, gameCode, { ...stored, state: nextState });
  return json({ ok: true, version: nextState.version }, 200, cors);
}
