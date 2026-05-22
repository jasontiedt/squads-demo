import { describe, expect, it } from 'vitest';

import {
  ACTION_TYPES,
  Action,
  ActionLogEntry,
  AttackAction,
  AttackMode,
  BuildBarracksAction,
  BuildCampAction,
  DeployUnitAction,
  DiscardEventAction,
  EndPhaseAction,
  EndTurnAction,
  MoveUnitAction,
  PlayActionCardAction,
  PlayCardAction,
  PlayEventAction,
  PlayReactionAction,
  PlayTacticAction,
  PlayTechnologyAction,
  PlayUpgradeAction,
  RecruitDrawAction,
  RelocateBuildingAction,
  ResupplyAction,
  ScoutAction,
  SwitchAttackModeAction,
  UnitAbilityAction,
} from '../index.js';

const u = (id: string) => id; // unbranded literals — Zod brands at parse
const b = (id: string) => id;
const c = (id: string) => id;
const square = { x: 0, y: 0 };
const target = { x: 1, y: 1 };

describe('AttackMode enum', () => {
  it('accepts melee and ranged', () => {
    expect(AttackMode.parse('melee')).toBe('melee');
    expect(AttackMode.parse('ranged')).toBe('ranged');
  });

  it('rejects other modes', () => {
    expect(() => AttackMode.parse('charge')).toThrow();
  });
});

describe('Mobilization actions — happy parse + reject missing required', () => {
  it('MoveUnit', () => {
    const a = { type: 'MoveUnit', unitId: u('u1'), from: square, to: target };
    expect(MoveUnitAction.parse(a)).toEqual(a);
    expect(() => MoveUnitAction.parse({ ...a, unitId: undefined })).toThrow();
    expect(() => MoveUnitAction.parse({ ...a, to: undefined })).toThrow();
  });

  it('Scout', () => {
    const a = { type: 'Scout', unitId: u('u1'), target };
    expect(ScoutAction.parse(a)).toEqual(a);
    expect(() => ScoutAction.parse({ ...a, target: undefined })).toThrow();
  });

  it('BuildCamp', () => {
    const a = {
      type: 'BuildCamp',
      builderUnitId: u('u1'),
      square,
      terrain: 'plain' as const,
    };
    expect(BuildCampAction.parse(a)).toEqual(a);
    expect(() =>
      BuildCampAction.parse({ ...a, terrain: 'volcano' as unknown as 'plain' }),
    ).toThrow();
    expect(() => BuildCampAction.parse({ ...a, builderUnitId: undefined })).toThrow();
  });

  it('BuildBarracks', () => {
    const a = { type: 'BuildBarracks', builderUnitId: u('u1'), square };
    expect(BuildBarracksAction.parse(a)).toEqual(a);
    expect(() => BuildBarracksAction.parse({ ...a, square: undefined })).toThrow();
  });

  it('RelocateBuilding', () => {
    const a = { type: 'RelocateBuilding', buildingId: b('b1'), to: target };
    expect(RelocateBuildingAction.parse(a)).toEqual(a);
    expect(() => RelocateBuildingAction.parse({ ...a, buildingId: undefined })).toThrow();
  });

  it('SwitchAttackMode', () => {
    const a = { type: 'SwitchAttackMode', unitId: u('u1') };
    expect(SwitchAttackModeAction.parse(a)).toEqual(a);
    expect(() => SwitchAttackModeAction.parse({ ...a, unitId: undefined })).toThrow();
  });

  it('UnitAbility — abilityKey required, payload optional', () => {
    const a = { type: 'UnitAbility', unitId: u('u1'), abilityKey: 'phalanx' };
    expect(UnitAbilityAction.parse(a)).toEqual(a);
    expect(() => UnitAbilityAction.parse({ ...a, abilityKey: '' })).toThrow();
    expect(() => UnitAbilityAction.parse({ ...a, abilityKey: undefined })).toThrow();
    // optional payload OK
    const withPayload = { ...a, payload: { foo: 1 } };
    expect(UnitAbilityAction.parse(withPayload)).toEqual(withPayload);
  });

  it('Resupply', () => {
    const a = { type: 'Resupply', unitId: u('u1') };
    expect(ResupplyAction.parse(a)).toEqual(a);
    expect(() => ResupplyAction.parse({ type: 'Resupply' })).toThrow();
  });

  it('RecruitDraw — empty payload', () => {
    const a = { type: 'RecruitDraw' };
    expect(RecruitDrawAction.parse(a)).toEqual(a);
  });

  it('PlayTactic', () => {
    const a = { type: 'PlayTactic', cardId: c('card-1') };
    expect(PlayTacticAction.parse(a)).toEqual(a);
    expect(() => PlayTacticAction.parse({ ...a, cardId: undefined })).toThrow();
  });

  it('PlayCard — cardId required, target optional, rejects extras (strict)', () => {
    const a = { type: 'PlayCard', cardId: c('eng-tactic-rally') };
    expect(PlayCardAction.parse(a)).toEqual(a);
    expect(() => PlayCardAction.parse({ ...a, cardId: undefined })).toThrow();
    // Optional target accepted (forward-compat for future card effects).
    const withTarget = { ...a, target: { unitId: u('u1') } };
    expect(PlayCardAction.parse(withTarget)).toEqual(withTarget);
    // Strict — unknown keys rejected.
    expect(() =>
      PlayCardAction.parse({ ...a, extraField: 'nope' }),
    ).toThrow();
  });
});describe('AttackAction refine — exactly one target', () => {
  const base = {
    type: 'Attack' as const,
    attackerUnitId: u('u1'),
    mode: 'melee' as const,
  };

  it('accepts unit-only target', () => {
    const a = { ...base, targetUnitId: u('u2') };
    expect(AttackAction.parse(a)).toEqual(a);
  });

  it('accepts building-only target', () => {
    const a = { ...base, targetBuildingId: b('b2') };
    expect(AttackAction.parse(a)).toEqual(a);
  });

  it('rejects when both targets are set', () => {
    expect(() =>
      AttackAction.parse({
        ...base,
        targetUnitId: u('u2'),
        targetBuildingId: b('b2'),
      }),
    ).toThrow(/exactly one/);
  });

  it('rejects when neither target is set', () => {
    expect(() => AttackAction.parse(base)).toThrow(/exactly one/);
  });

  it('rejects unknown mode', () => {
    expect(() =>
      AttackAction.parse({
        ...base,
        targetUnitId: u('u2'),
        mode: 'siege' as unknown as 'melee',
      }),
    ).toThrow();
  });
});

describe('Deployment actions — happy parse + reject missing required', () => {
  it('DeployUnit', () => {
    const a = { type: 'DeployUnit', cardId: c('eng-knight'), square };
    expect(DeployUnitAction.parse(a)).toEqual(a);
    expect(() => DeployUnitAction.parse({ ...a, square: undefined })).toThrow();
    expect(() => DeployUnitAction.parse({ ...a, cardId: undefined })).toThrow();
  });

  it('PlayTechnology', () => {
    const a = { type: 'PlayTechnology', cardId: c('tech-1') };
    expect(PlayTechnologyAction.parse(a)).toEqual(a);
    expect(() => PlayTechnologyAction.parse({ ...a, cardId: undefined })).toThrow();
  });

  it('PlayUpgrade', () => {
    const a = { type: 'PlayUpgrade', cardId: c('upg-1'), targetUnitId: u('u1') };
    expect(PlayUpgradeAction.parse(a)).toEqual(a);
    expect(() => PlayUpgradeAction.parse({ ...a, targetUnitId: undefined })).toThrow();
  });

  it('PlayAction (action card)', () => {
    const a = { type: 'PlayAction', cardId: c('act-1') };
    expect(PlayActionCardAction.parse(a)).toEqual(a);
    expect(() => PlayActionCardAction.parse({ ...a, cardId: undefined })).toThrow();
  });

  it('PlayEvent', () => {
    const a = { type: 'PlayEvent', cardId: c('evt-1') };
    expect(PlayEventAction.parse(a)).toEqual(a);
  });

  it('DiscardEvent', () => {
    const a = { type: 'DiscardEvent', cardId: c('evt-1') };
    expect(DiscardEventAction.parse(a)).toEqual(a);
  });
});

describe("Opponent's-turn actions", () => {
  it('PlayReaction — schema-only stub', () => {
    const a = { type: 'PlayReaction', cardId: c('rxn-1'), triggerLogIndex: 3 };
    expect(PlayReactionAction.parse(a)).toEqual(a);
  });

  it('PlayReaction rejects negative triggerLogIndex', () => {
    expect(() =>
      PlayReactionAction.parse({
        type: 'PlayReaction',
        cardId: c('rxn-1'),
        triggerLogIndex: -1,
      }),
    ).toThrow();
  });

  it('PlayReaction rejects non-integer triggerLogIndex', () => {
    expect(() =>
      PlayReactionAction.parse({
        type: 'PlayReaction',
        cardId: c('rxn-1'),
        triggerLogIndex: 1.5,
      }),
    ).toThrow();
  });
});

describe('Phase-control actions', () => {
  it('EndPhase — empty payload', () => {
    expect(EndPhaseAction.parse({ type: 'EndPhase' })).toEqual({ type: 'EndPhase' });
  });

  it('EndTurn — empty payload', () => {
    expect(EndTurnAction.parse({ type: 'EndTurn' })).toEqual({ type: 'EndTurn' });
  });
});

describe('Action discriminated union', () => {
  it('rejects unknown discriminator type', () => {
    expect(() => Action.parse({ type: 'Teleport', unitId: u('u1') })).toThrow();
  });

  it('rejects missing discriminator', () => {
    expect(() => Action.parse({ unitId: u('u1') })).toThrow();
  });

  it('strips no extras — strict object rejects unknown keys', () => {
    expect(() =>
      Action.parse({ type: 'EndTurn', extraField: 'nope' }),
    ).toThrow();
  });

  // One sample per union member — proves the union routes by discriminator.
  const samples: Array<{ type: string; sample: unknown }> = [
    { type: 'MoveUnit', sample: { type: 'MoveUnit', unitId: u('u1'), from: square, to: target } },
    { type: 'Scout', sample: { type: 'Scout', unitId: u('u1'), target } },
    {
      type: 'BuildCamp',
      sample: { type: 'BuildCamp', builderUnitId: u('u1'), square, terrain: 'plain' },
    },
    { type: 'BuildBarracks', sample: { type: 'BuildBarracks', builderUnitId: u('u1'), square } },
    { type: 'RelocateBuilding', sample: { type: 'RelocateBuilding', buildingId: b('b1'), to: target } },
    {
      type: 'Attack',
      sample: {
        type: 'Attack',
        attackerUnitId: u('u1'),
        targetUnitId: u('u2'),
        mode: 'melee',
      },
    },
    { type: 'SwitchAttackMode', sample: { type: 'SwitchAttackMode', unitId: u('u1') } },
    { type: 'UnitAbility', sample: { type: 'UnitAbility', unitId: u('u1'), abilityKey: 'k' } },
    { type: 'Resupply', sample: { type: 'Resupply', unitId: u('u1') } },
    { type: 'RecruitDraw', sample: { type: 'RecruitDraw' } },
    { type: 'PlayTactic', sample: { type: 'PlayTactic', cardId: c('card-1') } },
    { type: 'DeployUnit', sample: { type: 'DeployUnit', cardId: c('eng-knight'), square } },
    { type: 'PlayTechnology', sample: { type: 'PlayTechnology', cardId: c('tech-1') } },
    {
      type: 'PlayUpgrade',
      sample: { type: 'PlayUpgrade', cardId: c('upg-1'), targetUnitId: u('u1') },
    },
    { type: 'PlayAction', sample: { type: 'PlayAction', cardId: c('act-1') } },
    { type: 'PlayEvent', sample: { type: 'PlayEvent', cardId: c('evt-1') } },
    { type: 'DiscardEvent', sample: { type: 'DiscardEvent', cardId: c('evt-1') } },
    { type: 'PlayCard', sample: { type: 'PlayCard', cardId: c('card-x') } },
    {
      type: 'PlayReaction',
      sample: { type: 'PlayReaction', cardId: c('rxn-1'), triggerLogIndex: 0 },
    },
    { type: 'EndPhase', sample: { type: 'EndPhase' } },
    { type: 'EndTurn', sample: { type: 'EndTurn' } },
  ];

  for (const { type, sample } of samples) {
    it(`parses ${type} via the union`, () => {
      const parsed = Action.parse(sample) as { type: string };
      expect(parsed.type).toBe(type);
    });
  }

  it('ACTION_TYPES tuple covers every variant exactly once', () => {
    expect(new Set(ACTION_TYPES).size).toBe(ACTION_TYPES.length);
    expect(ACTION_TYPES.length).toBe(samples.length);
    for (const { type } of samples) {
      expect(ACTION_TYPES).toContain(type as (typeof ACTION_TYPES)[number]);
    }
  });
});

describe('Action embedded in ActionLogEntry', () => {
  it('parses an EndTurn entry', () => {
    const entry = {
      at: '2025-01-01T00:00:00.000Z',
      seat: 1 as const,
      action: { type: 'EndTurn' as const },
    };
    expect(ActionLogEntry.parse(entry)).toEqual(entry);
  });

  it('parses an Attack entry', () => {
    const entry = {
      at: '2025-02-02T12:00:00.000Z',
      seat: 2 as const,
      action: {
        type: 'Attack' as const,
        attackerUnitId: u('u1'),
        targetBuildingId: b('b9'),
        mode: 'ranged' as const,
      },
    };
    expect(ActionLogEntry.parse(entry)).toEqual(entry);
  });

  it('rejects an entry whose action fails refine (Attack with no target)', () => {
    expect(() =>
      ActionLogEntry.parse({
        at: '2025-01-01T00:00:00.000Z',
        seat: 1,
        action: { type: 'Attack', attackerUnitId: u('u1'), mode: 'melee' },
      }),
    ).toThrow();
  });
});
