import { z } from 'zod';
import { CardId } from './cards.js';
import { BuildingInstanceId, UnitInstanceId } from './ids.js';

// ─────────────────────────── Actions ──────────────────────────────
//
// Issue #5: Discriminated `Action` union — every legal player input.
//
// Per the issue spec (and `wedge-rulebook-synthesis.md`) actions are
// grouped by phase, but the schema does NOT enforce phase legality —
// that is a rules-engine concern (`applyAction`, #6+). Here we only
// validate shape: each action carries the minimum payload needed by
// the engine to execute it.
//
//   • Mobilization: MoveUnit, Scout, BuildCamp, BuildBarracks,
//     RelocateBuilding, Attack, SwitchAttackMode, UnitAbility,
//     Resupply, RecruitDraw, PlayTactic
//   • Deployment:   DeployUnit, PlayTechnology, PlayUpgrade, PlayAction,
//     PlayEvent, DiscardEvent, PlayTactic (also)
//   • Opponent:     PlayReaction (schema-only stub for MVP-1)
//   • Phase:        EndPhase, EndTurn
//
// All variants are `.strict()` so unknown payload keys are rejected at
// parse time rather than silently stripped — the engine should never
// see fields it didn't ask for.
//
// Card- and instance-id refs use the branded ids from `./cards.ts`
// and `./state.ts`. They're nominal at the type level but accept raw
// strings at parse time, so callers can build actions from JSON.
//
// `PlayReaction` carries `triggerLogIndex: number` to point at the
// `ActionLogEntry` it reacts to. No effect semantics — the rules
// engine ignores it for MVP-1, the field exists so the schema doesn't
// break when reactions land.
//
// `UnitAbility` and the `Play*` actions take `payload: z.unknown()`
// because their effect payloads are card-specific and live in the
// card catalog (loaded by `@eoe/rules`). `unknown()` accepts undefined,
// so a missing payload parses — that matches the cards.ts choice for
// `effect`/`trigger`.

// ─────────────────────────── Local re-declarations ───────────────────
//
// `Coord` is defined in `./index.ts`, which re-exports `./actions.js`.
// Importing from the barrel here would create a TDZ cycle (Zod evaluates
// eagerly at module load — the same hazard we hit for cards.ts/civ.ts
// and state.ts). Re-declared locally; structurally identical to the
// `Coord` exported from the barrel, so consumers see the same TS type.
const Coord = z.object({
  x: z.number().int().min(0).max(5),
  y: z.number().int().min(0).max(5),
});
type Coord = z.infer<typeof Coord>;

const TerrainType = z.enum([
  'plain',
  'mountain',
  'water',
  'river',
  'village',
  'farmland',
  'forest',
  'mine',
  'gold-double',
]);
type TerrainType = z.infer<typeof TerrainType>;

/** Shared melee/ranged attack mode — also used by `Attack` and `SwitchAttackMode`. */
export const AttackMode = z.enum(['melee', 'ranged']);
export type AttackMode = z.infer<typeof AttackMode>;

// ─────────────────────────── Mobilization phase ──────────────────────

export const MoveUnitAction = z
  .object({
    type: z.literal('MoveUnit'),
    unitId: UnitInstanceId,
    from: Coord,
    to: Coord,
  })
  .strict();
export type MoveUnitAction = z.infer<typeof MoveUnitAction>;

export const ScoutAction = z
  .object({
    type: z.literal('Scout'),
    unitId: UnitInstanceId,
    target: Coord,
  })
  .strict();
export type ScoutAction = z.infer<typeof ScoutAction>;

export const BuildCampAction = z
  .object({
    type: z.literal('BuildCamp'),
    builderUnitId: UnitInstanceId,
    square: Coord,
    terrain: TerrainType,
  })
  .strict();
export type BuildCampAction = z.infer<typeof BuildCampAction>;

export const BuildBarracksAction = z
  .object({
    type: z.literal('BuildBarracks'),
    builderUnitId: UnitInstanceId,
    square: Coord,
  })
  .strict();
export type BuildBarracksAction = z.infer<typeof BuildBarracksAction>;

export const RelocateBuildingAction = z
  .object({
    type: z.literal('RelocateBuilding'),
    buildingId: BuildingInstanceId,
    to: Coord,
  })
  .strict();
export type RelocateBuildingAction = z.infer<typeof RelocateBuildingAction>;

/**
 * Attack — exactly one of `targetUnitId` or `targetBuildingId` must be set.
 *
 * `_AttackBase` is the plain `.strict()` object used inside the
 * discriminated union (Zod 3's `discriminatedUnion` rejects
 * `ZodEffects`, so refines can't sit on a union member directly).
 * The XOR check is replayed at the union level via `.superRefine`
 * below. `AttackAction` re-applies the refine for callers that parse
 * an Attack directly (e.g. unit tests, fine-grained validators).
 */
const _AttackBase = z
  .object({
    type: z.literal('Attack'),
    attackerUnitId: UnitInstanceId,
    targetUnitId: UnitInstanceId.optional(),
    targetBuildingId: BuildingInstanceId.optional(),
    mode: AttackMode,
  })
  .strict();

const attackXorMessage =
  'Attack must target exactly one of `targetUnitId` or `targetBuildingId`.';

const attackXorOk = (a: z.infer<typeof _AttackBase>) =>
  (a.targetUnitId !== undefined) !== (a.targetBuildingId !== undefined);

export const AttackAction = _AttackBase.refine(attackXorOk, { message: attackXorMessage });
export type AttackAction = z.infer<typeof AttackAction>;

export const SwitchAttackModeAction = z
  .object({
    type: z.literal('SwitchAttackMode'),
    unitId: UnitInstanceId,
  })
  .strict();
export type SwitchAttackModeAction = z.infer<typeof SwitchAttackModeAction>;

/**
 * Card-defined ability invoked on a deployed unit.
 *
 * @needs-confirmation: `abilityKey` is `z.string().min(1)` (free-form)
 *   for MVP-1. The card catalog defines what keys are legal per unit;
 *   the schema can't enumerate them without the full catalog. Tighten
 *   to a discriminated union of known keys once the catalog stabilises
 *   — see `.squad/decisions/inbox/artoo-card-effect-typing.md` for
 *   precedent on `effect`/`trigger`.
 */
export const UnitAbilityAction = z
  .object({
    type: z.literal('UnitAbility'),
    unitId: UnitInstanceId,
    abilityKey: z.string().min(1),
    payload: z.unknown().optional(),
  })
  .strict();
export type UnitAbilityAction = z.infer<typeof UnitAbilityAction>;

export const ResupplyAction = z
  .object({
    type: z.literal('Resupply'),
    unitId: UnitInstanceId,
  })
  .strict();
export type ResupplyAction = z.infer<typeof ResupplyAction>;

export const RecruitDrawAction = z
  .object({
    type: z.literal('RecruitDraw'),
  })
  .strict();
export type RecruitDrawAction = z.infer<typeof RecruitDrawAction>;

/**
 * Tactic — playable in BOTH Mobilization and Deployment per the rulebook
 * (it is the only Mobilization-AND-Deployment card). Phase legality is
 * a rules-engine concern; the schema accepts the action in either phase.
 */
export const PlayTacticAction = z
  .object({
    type: z.literal('PlayTactic'),
    cardId: CardId,
    payload: z.unknown().optional(),
  })
  .strict();
export type PlayTacticAction = z.infer<typeof PlayTacticAction>;

// ─────────────────────────── Deployment phase ────────────────────────

export const DeployUnitAction = z
  .object({
    type: z.literal('DeployUnit'),
    cardId: CardId,
    square: Coord,
  })
  .strict();
export type DeployUnitAction = z.infer<typeof DeployUnitAction>;

export const PlayTechnologyAction = z
  .object({
    type: z.literal('PlayTechnology'),
    cardId: CardId,
  })
  .strict();
export type PlayTechnologyAction = z.infer<typeof PlayTechnologyAction>;

export const PlayUpgradeAction = z
  .object({
    type: z.literal('PlayUpgrade'),
    cardId: CardId,
    targetUnitId: UnitInstanceId,
  })
  .strict();
export type PlayUpgradeAction = z.infer<typeof PlayUpgradeAction>;

export const PlayActionCardAction = z
  .object({
    type: z.literal('PlayAction'),
    cardId: CardId,
    payload: z.unknown().optional(),
  })
  .strict();
export type PlayActionCardAction = z.infer<typeof PlayActionCardAction>;

export const PlayEventAction = z
  .object({
    type: z.literal('PlayEvent'),
    cardId: CardId,
  })
  .strict();
export type PlayEventAction = z.infer<typeof PlayEventAction>;

export const DiscardEventAction = z
  .object({
    type: z.literal('DiscardEvent'),
    cardId: CardId,
  })
  .strict();
export type DiscardEventAction = z.infer<typeof DiscardEventAction>;

// ─────────────────────────── Generic card play (MVP-2 / #36) ─────────
//
// PlayCard is the MVP-2 generic entry point for resolving a card from
// the player's hand. It coexists with the typed `Play*` variants
// (Tactic / Technology / Upgrade / Action / Event) which remain for
// future per-kind handlers; PlayCard is the simplest path that the
// rules engine can resolve today.
//
// Issue #36 picks ONE concrete effect: "discard this card, then draw 1".
// No target is required for that effect. The optional `target` field is
// reserved for future card effects (place-unit, deal-damage, etc.) and
// is intentionally `z.unknown()` — same loose-payload pattern as
// `PlayTactic.payload` (see `.squad/decisions/inbox/artoo-card-effect-typing.md`).
//
// Effect dispatch is hardcoded to "draw 1" in the rules engine for MVP-2.
// Once the card catalog grows real effect DSLs (#41+), the engine will
// look up the card and dispatch by effect — at that point the schema
// stays stable.
export const PlayCardAction = z
  .object({
    type: z.literal('PlayCard'),
    cardId: CardId,
    target: z.unknown().optional(),
  })
  .strict();
export type PlayCardAction = z.infer<typeof PlayCardAction>;

// ─────────────────────────── Opponent's turn ─────────────────────────

/**
 * Reaction — schema-only stub for MVP-1. The rules engine does NOT
 * resolve reactions yet (matches `Reaction` card kind in `./cards.ts`).
 *
 * `triggerLogIndex` points at the `ActionLogEntry` in `GameState.moveLog`
 * that the reaction is responding to. Index is `nonnegative` because
 * log entries are appended; reaction can target the latest entry (index
 * = log.length - 1) or any prior entry within the open reaction window.
 */
export const PlayReactionAction = z
  .object({
    type: z.literal('PlayReaction'),
    cardId: CardId,
    triggerLogIndex: z.number().int().nonnegative(),
  })
  .strict();
export type PlayReactionAction = z.infer<typeof PlayReactionAction>;

// ─────────────────────────── Phase control ───────────────────────────

export const EndPhaseAction = z
  .object({
    type: z.literal('EndPhase'),
  })
  .strict();
export type EndPhaseAction = z.infer<typeof EndPhaseAction>;

export const EndTurnAction = z
  .object({
    type: z.literal('EndTurn'),
  })
  .strict();
export type EndTurnAction = z.infer<typeof EndTurnAction>;

// ─────────────────────────── Discriminated union ─────────────────────
//
// Zod 3's `discriminatedUnion` rejects `ZodEffects`, so the union uses
// `_AttackBase` (the unrefined Attack object) and replays the XOR check
// via `.superRefine` after discriminator routing. Standalone Attack
// validation still goes through the refined `AttackAction` export.

export const Action = z
  .discriminatedUnion('type', [
    // Mobilization
    MoveUnitAction,
    ScoutAction,
    BuildCampAction,
    BuildBarracksAction,
    RelocateBuildingAction,
    _AttackBase,
    SwitchAttackModeAction,
    UnitAbilityAction,
    ResupplyAction,
    RecruitDrawAction,
    PlayTacticAction,
    // Deployment
    DeployUnitAction,
    PlayTechnologyAction,
    PlayUpgradeAction,
    PlayActionCardAction,
    PlayEventAction,
    DiscardEventAction,
    PlayCardAction,
    // Opponent
    PlayReactionAction,
    // Phase control
    EndPhaseAction,
    EndTurnAction,
  ])
  .superRefine((a, ctx) => {
    if (a.type === 'Attack' && !attackXorOk(a)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: attackXorMessage,
        path: ['targetUnitId'],
      });
    }
  });
export type Action = z.infer<typeof Action>;

/**
 * Tuple of every legal `type` literal in the `Action` union. Useful for
 * exhaustiveness checks in the rules engine and tests.
 */
export const ACTION_TYPES = [
  'MoveUnit',
  'Scout',
  'BuildCamp',
  'BuildBarracks',
  'RelocateBuilding',
  'Attack',
  'SwitchAttackMode',
  'UnitAbility',
  'Resupply',
  'RecruitDraw',
  'PlayTactic',
  'DeployUnit',
  'PlayTechnology',
  'PlayUpgrade',
  'PlayAction',
  'PlayEvent',
  'DiscardEvent',
  'PlayCard',
  'PlayReaction',
  'EndPhase',
  'EndTurn',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
