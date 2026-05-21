# Decision: GameState shape (Issue #4)

**Author:** Artoo (backend / schema)
**Date:** 2026-05-20
**Branch:** copilot/4-schema-gamestate
**Status:** proposed — applied in code on this branch

## Context

Issue #4 calls for the central runtime model: `GameState`, `Player`, `UnitInstance`, `BuildingInstance`. Several shape decisions had to be locked in before #5 (rules engine) can build on them. The Zod-strict + branded-id house style + ESM-with-cycles environment made some of the choices non-obvious.

## Decisions

### 1. `BuildingInstance` is a discriminated union by `type`, with `.strict()` on every variant.

```ts
const CampInstance     = z.object({ id, type: z.literal('camp'),     owner, square, damage, terrain }).strict();
const BarracksInstance = z.object({ id, type: z.literal('barracks'), owner, square, damage          }).strict();
const CapitalInstance  = z.object({ id, type: z.literal('capital'),  owner, square, damage          }).strict();
const BuildingInstance = z.discriminatedUnion('type', [CampInstance, BarracksInstance, CapitalInstance]);
```

**Rationale:**
- `terrain` is meaningful only on Camps (it drives the resource kind they produce). Barracks and Capital must NOT have a `terrain` field.
- Discriminated union gives consumers (`#5` rules engine) free type narrowing: `if (b.type === 'camp') { b.terrain ... }` works without casts.
- **`.strict()` is mandatory.** Zod's default object mode is `.strip()` — unknown keys are silently removed, so a Barracks with `terrain: 'plain'` would parse-as-Barracks-without-terrain. `.strict()` makes the parse throw `unrecognized_keys`, which is what the design intends.

**Alternative considered and rejected:** single object + `.refine(b => b.type !== 'camp' || b.terrain !== undefined, ...)`. Loses narrowing, produces worse error messages, doesn't catch the symmetric case (Barracks with terrain).

### 2. `PlayersBySeat` is `z.object({1, 2, 3, 4})`, NOT `z.record(Seat, Player)`.

```ts
const PlayersBySeat = z.object({
  1: Player.optional(),
  2: Player.optional(),
  3: Player.optional(),
  4: Player.optional(),
});
```

**Rationale:** JSON object keys are always strings. `Seat = z.union([z.literal(1)..z.literal(4)])` validates against numeric literals, so `z.record(Seat, Player)` rejects any seat key (`{ '1': ... }`) with `invalid_literal, expected: 1, received: '1'`. Explicit `z.object` with optional fields gives the same shape with strict-mode correct keys. (Tested empirically — `z.record(Seat, Player)` failed the round-trip and 4-seat tests.)

### 3. `GameId` stays unbranded.

```ts
const GameId = z.string().min(4).max(16); // not branded
```

**Rationale:** worker stub passes raw `'STUB01'` and there is no value (yet) in forcing a `.brand<'GameId'>()` cast at every API boundary. Revisit when the worker starts generating ids itself or when there is at least one site that confuses `GameId` with another id type.

`UnitInstanceId`, `BuildingInstanceId`, `Seed`, `CardId`, `PlayerId`, `PlayerToken`, `ResourceTokenId`, `TemporaryResourceId` ARE branded — distinct id types that get mixed in the rules engine. `GameId` is a top-level identifier with no peers.

### 4. `ActionLogEntry` is a stub for #4, gets tightened in #5.

```ts
const ActionLogEntry = z.object({
  at: z.string().datetime(),         // ISO-8601
  seat: Seat,
  kind: z.string().min(1),           // @needs-confirmation: tighten to discriminated union after #5
  payload: z.unknown(),              // @needs-confirmation: shape per kind once Action union lands
});
```

**Rationale:** `GameState.moveLog` is an array of these and the rules engine doesn't exist yet. `kind` and `payload` are minimal — enough to round-trip in tests, not so loose that the tests are useless. Issue #5 will replace `kind` with a string-literal enum tied to `Action.type` and `payload` with the matching action body. Flagged `@needs-confirmation`.

### 5. `state.ts` locally re-declares `Seat`/`Coord`/`TerrainType`/`Square`/`TileKind`/`TileOrientation`/`Tile`.

**Rationale (cycle avoidance):** `state.ts` is imported by `index.ts` (the barrel). It needs the seven schemas listed above, but importing them from `./index.js` is a circular import that TDZs the schemas (Zod evaluates `z.union(...)`, `z.literal(...)` etc. eagerly at module load — the same hazard that forced the cards.ts/civ.ts split for issue #3). Local re-declarations break the cycle. They are structurally identical to the barrel exports — comment in `state.ts` flags this and the eventual cleanup is to extract a `map.ts` leaf module shared by both.

## Implications for #5 (rules engine)

- Action discriminator and ActionLogEntry payload typing are coupled — design them together.
- Hand cap (≤7) and active-events cap (≤3) are enforced at the schema level — `applyAction` must reject draws/plays that would push past these.
- Capital HP defaults to 10 (base) per rulebook line 77. Long-game variant is 20 (line 324) but that's a setup-mode decision, not a schema decision.
- `BuildingInstance.damage` and `UnitInstance.damage` are `int >= 0` and `Player.capitalHp` is `int >= 0` — rules engine clamps at zero rather than allowing negatives.

## What's NOT decided here

- The full Action union (#5).
- Per-civ unit/tech/tactic catalogs (#6, #7, ...).
- Persistence layer / KV key schema (Wedge's call).
- Map data population (Constantinople tile, highland tiles, starting-tile catalog) — schema accepts the shapes; data lands in #8 or later.
