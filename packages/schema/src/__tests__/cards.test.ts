import { describe, expect, it } from 'vitest';
import {
  Card,
  CardCost,
  CardId,
  CARD_KINDS,
  type CardKind,
} from '../index.js';

// ─────────────────────────────────────────────────────────────────────
// Helpers — minimal valid samples per kind. Keep these in lockstep with
// the schema; if a kind grows a required field, update the sample here.
// ─────────────────────────────────────────────────────────────────────

const sampleUnit = {
  kind: 'unit' as const,
  id: 'u-1',
  name: 'Hoplite',
  cost: { food: 1, gold: 2 },
  movement: { points: 2 },
  melee: 3,
  ranged: 0,
  health: 4,
  class: ['infantry'],
  keywords: ['phalanx'],
};

const sampleTechnology = {
  kind: 'technology' as const,
  id: 't-1',
  name: 'Stirrups',
  cost: { gold: 2 },
  subType: 'A' as const,
  effect: { note: 'placeholder' },
};

const sampleTactic = {
  kind: 'tactic' as const,
  id: 'tc-1',
  name: 'Forced March',
  cost: { food: 1 },
  playableIn: ['mobilization' as const],
  // Typed via locked Effect DSL (#83/#87).
  effect: { kind: 'draw' as const, count: 1 },
};

const sampleUpgrade = {
  kind: 'upgrade' as const,
  id: 'up-1',
  name: 'Iron Plating',
  cost: { gold: 1 },
  effect: 'placeholder',
};

const sampleAction = {
  kind: 'action' as const,
  id: 'a-1',
  name: 'Quick Strike',
  cost: { wild: 1 },
  // Typed via locked Effect DSL (#83/#87).
  effect: { kind: 'damage' as const, amount: 1, target: 'opponent-capital' as const },
};

const sampleReaction = {
  kind: 'reaction' as const,
  id: 'r-1',
  name: 'Counter-Spell',
  cost: {},
  // Typed via #101 — closed 5-trigger taxonomy.
  trigger: { kind: 'on-card-played' as const },
  // Typed via locked Effect DSL (#83/#87).
  effect: { kind: 'draw' as const, count: 1 },
};

const sampleEvent = {
  kind: 'event' as const,
  id: 'e-1',
  name: 'Plague',
  cost: { gold: 3 },
  persistent: true as const,
  ticksRemaining: 3,
  effect: { kind: 'draw' as const, count: 1 },
};

const sampleCivilization = {
  kind: 'civilization' as const,
  id: 'civ-1',
  name: 'Byzantine Empire',
  civId: 'byzantines' as const,
  effect: 'placeholder',
};

// ─────────────────────────────────────────────────────────────────────
// CardId — branded
// ─────────────────────────────────────────────────────────────────────

describe('CardId', () => {
  it('accepts a non-empty string', () => {
    expect(CardId.safeParse('u-1').success).toBe(true);
  });

  it('rejects empty string', () => {
    expect(CardId.safeParse('').success).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(CardId.safeParse(42).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// CardCost
// ─────────────────────────────────────────────────────────────────────

describe('CardCost', () => {
  it('accepts a valid resource→count map', () => {
    const result = CardCost.safeParse({ wood: 2, gold: 1 });
    expect(result.success).toBe(true);
  });

  it('accepts an empty cost', () => {
    expect(CardCost.safeParse({}).success).toBe(true);
  });

  it('rejects negative counts', () => {
    expect(CardCost.safeParse({ wood: -1 }).success).toBe(false);
  });

  it('rejects unknown resource keys', () => {
    expect(CardCost.safeParse({ ether: 1 }).success).toBe(false);
  });

  it('rejects non-integer counts', () => {
    expect(CardCost.safeParse({ wood: 1.5 }).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Per-kind happy + reject paths
// ─────────────────────────────────────────────────────────────────────

describe('UnitCard', () => {
  it('parses a minimal valid unit', () => {
    expect(Card.safeParse(sampleUnit).success).toBe(true);
  });

  it('rejects a unit with health 0', () => {
    expect(Card.safeParse({ ...sampleUnit, health: 0 }).success).toBe(false);
  });

  it('rejects a unit with negative melee', () => {
    expect(Card.safeParse({ ...sampleUnit, melee: -1 }).success).toBe(false);
  });

  it('rejects a unit missing movement', () => {
    const { movement: _movement, ...rest } = sampleUnit;
    expect(Card.safeParse(rest).success).toBe(false);
  });
});

describe('TechnologyCard', () => {
  it('parses a minimal valid technology', () => {
    expect(Card.safeParse(sampleTechnology).success).toBe(true);
  });

  it('rejects an unknown subType', () => {
    expect(
      Card.safeParse({ ...sampleTechnology, subType: 'Z' }).success,
    ).toBe(false);
  });

  it('rejects a technology missing subType', () => {
    const { subType: _subType, ...rest } = sampleTechnology;
    expect(Card.safeParse(rest).success).toBe(false);
  });
});

describe('TacticCard', () => {
  it('parses a minimal valid tactic', () => {
    expect(Card.safeParse(sampleTactic).success).toBe(true);
  });

  it('parses a tactic playable in both phases', () => {
    expect(
      Card.safeParse({
        ...sampleTactic,
        playableIn: ['mobilization', 'deployment'] as const,
      }).success,
    ).toBe(true);
  });

  it('rejects a tactic with empty playableIn', () => {
    expect(
      Card.safeParse({ ...sampleTactic, playableIn: [] }).success,
    ).toBe(false);
  });

  it('rejects an unknown phase', () => {
    expect(
      Card.safeParse({ ...sampleTactic, playableIn: ['endgame'] }).success,
    ).toBe(false);
  });
});

describe('UpgradeCard', () => {
  it('parses an upgrade without restrictedToClass (any-unit)', () => {
    expect(Card.safeParse(sampleUpgrade).success).toBe(true);
  });

  it('parses an upgrade with restrictedToClass', () => {
    expect(
      Card.safeParse({ ...sampleUpgrade, restrictedToClass: ['cavalry'] })
        .success,
    ).toBe(true);
  });

  it('rejects empty class strings inside restrictedToClass', () => {
    expect(
      Card.safeParse({ ...sampleUpgrade, restrictedToClass: [''] }).success,
    ).toBe(false);
  });
});

describe('ActionCard', () => {
  it('parses a minimal valid action', () => {
    expect(Card.safeParse(sampleAction).success).toBe(true);
  });

  it('rejects an action missing name', () => {
    const { name: _name, ...rest } = sampleAction;
    expect(Card.safeParse(rest).success).toBe(false);
  });
});

describe('ReactionCard (stub)', () => {
  it('parses a minimal valid reaction', () => {
    expect(Card.safeParse(sampleReaction).success).toBe(true);
  });

  it('rejects an unknown trigger kind (closed at 5 via #101)', () => {
    expect(
      Card.safeParse({ ...sampleReaction, trigger: { kind: 'on-eclipse' } })
        .success,
    ).toBe(false);
  });

  it('rejects a non-typed effect payload (Effect DSL locked)', () => {
    expect(
      Card.safeParse({ ...sampleReaction, effect: 'placeholder prose' })
        .success,
    ).toBe(false);
  });
});

describe('EventCard', () => {
  it('parses a minimal valid event', () => {
    expect(Card.safeParse(sampleEvent).success).toBe(true);
  });

  it('rejects persistent: false (events are always persistent)', () => {
    expect(
      Card.safeParse({ ...sampleEvent, persistent: false }).success,
    ).toBe(false);
  });

  it('rejects event missing persistent flag', () => {
    const { persistent: _persistent, ...rest } = sampleEvent;
    expect(Card.safeParse(rest).success).toBe(false);
  });
});

describe('CivilizationCard', () => {
  it('parses a minimal valid civilization card', () => {
    expect(Card.safeParse(sampleCivilization).success).toBe(true);
  });

  it('rejects an unknown civId', () => {
    expect(
      Card.safeParse({ ...sampleCivilization, civId: 'atlanteans' }).success,
    ).toBe(false);
  });

  it('rejects a civilization missing civId', () => {
    const { civId: _civId, ...rest } = sampleCivilization;
    expect(Card.safeParse(rest).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Common-field rejections (cover all kinds via parametrization)
// ─────────────────────────────────────────────────────────────────────

const allSamples: ReadonlyArray<readonly [CardKind, Record<string, unknown>]> = [
  ['unit', sampleUnit],
  ['technology', sampleTechnology],
  ['tactic', sampleTactic],
  ['upgrade', sampleUpgrade],
  ['action', sampleAction],
  ['reaction', sampleReaction],
  ['event', sampleEvent],
  ['civilization', sampleCivilization],
];

describe('Card common fields', () => {
  it.each(allSamples)('rejects %s with empty id', (_kind, sample) => {
    expect(Card.safeParse({ ...sample, id: '' }).success).toBe(false);
  });

  it.each(allSamples)('rejects %s with empty name', (_kind, sample) => {
    expect(Card.safeParse({ ...sample, name: '' }).success).toBe(false);
  });

  it.each(allSamples)(
    'accepts %s with optional civ/flavor/imageRef populated',
    (_kind, sample) => {
      const enriched = {
        ...sample,
        civ: 'byzantines' as const,
        flavor: 'Some flavor text',
        imageRef: 'card://hoplite.png',
      };
      expect(Card.safeParse(enriched).success).toBe(true);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────
// Discriminated-union + exhaustiveness
// ─────────────────────────────────────────────────────────────────────

describe('Card discriminated union', () => {
  it('rejects an unknown kind literal', () => {
    expect(
      Card.safeParse({ ...sampleAction, kind: 'monument' }).success,
    ).toBe(false);
  });

  it('rejects payloads with no kind', () => {
    const { kind: _kind, ...rest } = sampleAction;
    expect(Card.safeParse(rest).success).toBe(false);
  });

  it('CARD_KINDS matches the union members exactly', () => {
    const sampleByKind: Record<CardKind, Record<string, unknown>> = {
      unit: sampleUnit,
      technology: sampleTechnology,
      tactic: sampleTactic,
      upgrade: sampleUpgrade,
      action: sampleAction,
      reaction: sampleReaction,
      event: sampleEvent,
      civilization: sampleCivilization,
    };
    for (const kind of CARD_KINDS) {
      const result = Card.safeParse(sampleByKind[kind]);
      expect(result.success, `kind=${kind} should parse`).toBe(true);
    }
    expect(CARD_KINDS).toHaveLength(8);
  });

  it('parsed cards retain their kind', () => {
    const parsed = Card.parse(sampleUnit);
    expect(parsed.kind).toBe('unit');
  });
});
