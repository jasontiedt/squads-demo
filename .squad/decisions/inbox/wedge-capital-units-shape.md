### 2026-05-23T00:00:00Z: Capital tile membership + units[] shape (RFC for MVP-5)

**By:** Wedge (Lead / Architect) — issue #69
**What:** Keep `state.units` flat (`UnitInstance[]` with `owner: Seat`). Extend `CapitalInstance` with `tileId: TileId` (denormalized link to the containing tile) and `siegeState: 'open' | 'sieged' | 'fallen'`. No change to `Player`. Card-effect targeting helpers (`unitsFor(seat)`, `tileOf(building)`) land alongside the migration as pure utilities in `@eoe/rules`.
**Why:** Most engine queries are global (redact, render, range-check, validate). Per-player queries are minority and cheap at ≤ ~20 units. Duplicating units onto `Player` creates a drift surface (capture/conversion cards mutate `owner`); denormalizing `tileId` onto a capital is safe because capitals don't move. `siegeState` has no other home and is the smallest shape that unblocks siege-style effects.
**Reviewers:** Artoo (rules-engine impact), Cassian (test-shape impact)
**Status:** OPEN — sign-off via PR review comments

---

## Background

Two gaps surfaced during MVP-3 (capital init #57, attack handler #54) and were flagged in `artoo-capital-init` as `@needs-rfc`:

1. **Capital → tile link.** `BuildingInstance` (capital variant) carries `square: Coord` but no reference to the tile that contains the square. Card effects like "siege the tile containing your opponent's capital" or "deal 1 damage to every unit on the same tile as a sieged capital" need either an O(1) link or an on-demand `Coord → Tile` lookup over `state.map.tiles` (~9 tiles × 4 squares = 36 entries — cheap, but every call site repeats it).

2. **Capital siege state.** No field expresses "this capital is currently under siege" or "this capital has fallen". The win condition (#55) currently fires on `capitalHp === 0` directly; siege mechanics from the rulebook (besieger present on capital's tile, capital can't produce, etc.) have nowhere to live.

3. **Units shape.** `state.units: UnitInstance[]` is flat with `owner: Seat`. Card effects targeting "all your units" iterate-filter; targeting "all units on tile X" iterate-filter on coords. Some shops would prefer `state.players[seat].units: UnitInstance[]` for locality.

Pinning interpretations of #1 and #2 in handler code (per-card workarounds) would cascade — every siege-adjacent card invents its own representation. Pinning #3 the wrong way creates a refactor cliff once a third of the card catalog depends on the shape.

## Proposal

ONE coherent shape. Three concrete schema deltas + two engine helpers.

### Schema (Zod / `packages/schema/src/state.ts`)

```ts
// NEW — branded id from ./ids.ts
export const TileId = z.string().min(1).brand<'TileId'>();
export type TileId = z.infer<typeof TileId>;

// CHANGED — Tile gets an explicit id (today `Tile.id: z.string()` is unbranded).
// Promote to branded TileId so capital.tileId is a typed link, not a free string.
const Tile = z.object({
  id: TileId,
  kind: TileKind,
  orientation: TileOrientation,
  faceDown: z.boolean(),
  squares: z.array(Square).length(4),
});

// NEW — siege state for capitals
export const SiegeState = z.enum(['open', 'sieged', 'fallen']);
export type SiegeState = z.infer<typeof SiegeState>;

// CHANGED — CapitalInstance gains tileId + siegeState. Camp/Barracks unchanged.
export const CapitalInstance = z
  .object({
    id: BuildingInstanceId,
    type: z.literal('capital'),
    owner: Seat,
    square: Coord,
    damage: z.number().int().min(0),
    tileId: TileId,                // NEW — link to containing tile
    siegeState: SiegeState,        // NEW — defaults 'open' at init, 'fallen' when hp 0
  })
  .strict();

// UNCHANGED — units stay flat on GameState
export const GameState = z.object({
  // ... existing fields ...
  units: z.array(UnitInstance),    // flat, owner: Seat — unchanged
  buildings: z.array(BuildingInstance),
  // ...
});
```

### Engine helpers (`packages/rules/src/queries.ts` — new file)

Pure, no I/O, no side effects. Drop-in replacements for the iterate-filter idioms card handlers will otherwise duplicate.

```ts
// O(units)
export const unitsFor = (state: GameState, seat: Seat): readonly UnitInstance[] =>
  state.units.filter(u => u.owner === seat);

// O(units)
export const unitsOnTile = (state: GameState, tileId: TileId): readonly UnitInstance[] =>
  state.units.filter(u => tileOfSquare(state, u.square) === tileId);

// O(tiles*4) — capital lookup is by-seat
export const capitalOf = (state: GameState, seat: Seat): CapitalInstance | undefined =>
  state.buildings.find(
    (b): b is CapitalInstance => b.type === 'capital' && b.owner === seat,
  );

// O(tiles*4) — coord → tile reverse lookup; used by initialState + handlers
export const tileOfSquare = (state: GameState, c: Coord): TileId | undefined => { /* ... */ };
```

## Migration sketch

MVP-5 first PR — single rules-engine change:

| File | Change |
|---|---|
| `packages/schema/src/ids.ts` | Add branded `TileId`. |
| `packages/schema/src/state.ts` | Promote `Tile.id` to `TileId`. Add `SiegeState`. Extend `CapitalInstance` with `tileId` + `siegeState`. |
| `packages/rules/src/initialState.ts` | When placing capitals, compute `tileId` via `tileOfSquare`, seed `siegeState: 'open'`. |
| `packages/rules/src/queries.ts` | NEW — `unitsFor`, `unitsOnTile`, `capitalOf`, `tileOfSquare`. |
| `packages/rules/src/attack.ts` | When capital takes lethal damage, set `siegeState: 'fallen'` (and `phase: 'ended'` per #55 stays unchanged). |
| `packages/rules/src/__tests__/initialState.test.ts` | Assert capitals have `tileId` matching their `square`'s tile and `siegeState: 'open'`. |
| `packages/rules/src/__tests__/attack.test.ts` | Assert `siegeState` transitions to `'fallen'` on lethal hit. |
| `apps/worker/src/redact.ts` | No change — `tileId`/`siegeState` are public. |
| Test fixtures | `initial-state.ts` adds `tileId` + `siegeState: 'open'` to capital records. |

**Blast radius:** schema (additive — no field removal), rules engine (one helper file, two handler edits), worker (zero), client (zero — fields are extra data, not breaking). Estimated one focused PR; no cross-package coordination beyond review.

## Alternatives considered

### A. Compute `tileId` on demand, no field on capital

- **Pro:** No schema change for tile membership; `tileOfSquare(state, capital.square)` everywhere.
- **Con:** Every siege-effect handler repeats the same lookup. Once 5+ cards reference siege, the implicit-lookup pattern is a worse maintenance shape than a typed field. Capitals are fixed at game start and don't move — denormalization cost is zero.
- **Rejected:** denormalization is safe here; explicit beats implicit when the field is read often and never mutated post-init.

### B. Put `siegeState` on `Player` instead of `CapitalInstance`

- **Pro:** Co-located with `capitalHp`.
- **Con:** Siege is fundamentally a building/board concept. Reaction-window triggers and card targeting want to ask "is this capital sieged?" given a `BuildingInstance`, not given a `Seat`. Splitting capital state across two records (HP on Player, siege on building) is the wrong cut.
- **Rejected:** keep capital state with the capital.

### C. Per-player units: `state.players[seat].units: UnitInstance[]`

- **Pro:** O(units-for-seat) locality. "All your units" becomes a direct array.
- **Con (1):** Duplicates `owner` info. If a card transfers ownership (capture, conversion — known rulebook mechanic), the engine must move the unit between two arrays atomically. Bug surface.
- **Con (2):** Every global query (redact, render, range-check, target validation, win condition) becomes a two-step gather across `state.players[1..4].units`. Today these are the hot paths; per-player queries are not.
- **Con (3):** Test fixtures and `initialState` get noisier; current flat `units: []` is one line.
- **Rejected:** the locality win doesn't justify the duplication risk, and the helper `unitsFor(state, seat)` recovers ergonomic per-player access at iterate-filter cost (negligible at ≤ ~20 units).

### D. Both shapes (denormalized)

- **Rejected outright:** drift risk. Any handler that forgets one update creates a state that parses-valid but is internally inconsistent. Not worth the marginal speedup.

### E. Index-on-the-side: `state.unitsBySeat: Record<Seat, UnitInstanceId[]>`

- **Pro:** Locality without duplicating the unit records.
- **Con:** Still a denormalized index that handlers must maintain. Same drift risk as D, just smaller.
- **Rejected:** if the iterate-filter ever becomes a measured bottleneck (it won't at MVP scale), revisit then.

## MVP-5 unlock examples

**Pattern 1 — Siege effect ("Besiege the capital on this tile"):**

```ts
// Card handler (pseudocode)
const cap = capitalOf(state, defender);
if (cap && cap.tileId === targetTileId) {
  return patch(state, { buildings: replace(cap, { ...cap, siegeState: 'sieged' }) });
}
```

Without `tileId` + `siegeState`, this handler invents its own siege representation (e.g., a side-channel `Set<BuildingInstanceId>` on `GameState`) or repeats a `tileOfSquare` lookup at every call site.

**Pattern 2 — Global per-player effect ("Heal all your units 1 damage"):**

```ts
const mine = unitsFor(state, actor);
return patch(state, {
  units: state.units.map(u =>
    mine.includes(u) ? { ...u, damage: Math.max(0, u.damage - 1) } : u,
  ),
});
```

Flat units + `unitsFor` helper keeps this readable without per-player arrays. The handler's intent is clear; the iterate-filter is invisible behind the helper name.

**Pattern 3 — Win condition refinement (rulebook §"Siege"):**

If MVP-6+ adds "you win if you hold a sieged enemy capital at end-of-turn for 2 turns", the `siegeState` enum extends to `'sieged-1' | 'sieged-2' | 'fallen'` (or a `siegedSince: Turn` field) without touching the units shape or capital placement. Localized change.

---

**Net:** smallest schema delta that closes the three open gaps, keeps the flat-units invariant intact, and gives card handlers two readable helpers instead of inline iterate-filter idioms. Migration is one PR, additive only, no client/worker breakage.
