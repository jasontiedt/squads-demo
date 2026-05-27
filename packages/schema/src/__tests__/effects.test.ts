import { describe, expect, it } from 'vitest';
import {
  Effect,
  Target,
  DrawEffect,
  DamageEffect,
  HealCapitalEffect,
  GainTemporaryResourceEffect,
  BuffUnitStatEffect,
  AttachKeywordEffect,
  ClassWidePassiveEffect,
  EFFECT_KINDS,
  UnitInstanceId,
} from '../index.js';

// ─────────────────────────────────────────────────────────────────────
// Effect DSL — locked in #83. Each verb gets at least one happy parse
// and one rejection. Adding a verb here without coordinating with Wedge
// is a schema-major change; see effects.ts header.
// ─────────────────────────────────────────────────────────────────────

const someUnitId = UnitInstanceId.parse('uinst-1');

describe('Effect DSL', () => {
  it('locks the verb list', () => {
    expect(EFFECT_KINDS).toEqual([
      'draw',
      'damage',
      'heal-capital',
      'gain-temporary-resource',
      'buff-unit-stat',
      'attach-keyword',
      'class-wide-passive',
    ]);
  });

  describe('draw', () => {
    it('parses a valid draw effect', () => {
      const e = { kind: 'draw', count: 2 };
      expect(DrawEffect.parse(e)).toEqual(e);
      expect(Effect.parse(e).kind).toBe('draw');
    });
    it('rejects count < 1', () => {
      expect(() => DrawEffect.parse({ kind: 'draw', count: 0 })).toThrow();
    });
    it('rejects non-integer count', () => {
      expect(() => DrawEffect.parse({ kind: 'draw', count: 1.5 })).toThrow();
    });
  });

  describe('damage', () => {
    it('parses damage against a capital', () => {
      const e = { kind: 'damage', amount: 3, target: 'opponent-capital' };
      expect(Effect.parse(e)).toEqual(e);
    });
    it('parses damage against a specific unit', () => {
      const e = {
        kind: 'damage',
        amount: 1,
        target: { kind: 'unit', unitId: someUnitId },
      };
      expect(DamageEffect.parse(e)).toEqual(e);
    });
    it('rejects amount < 1', () => {
      expect(() =>
        DamageEffect.parse({ kind: 'damage', amount: 0, target: 'self-capital' }),
      ).toThrow();
    });
    it('rejects an invalid target string', () => {
      expect(() =>
        DamageEffect.parse({ kind: 'damage', amount: 1, target: 'nope' }),
      ).toThrow();
    });
  });

  describe('heal-capital', () => {
    it('parses a valid heal', () => {
      const e = { kind: 'heal-capital', amount: 2, target: 'self' };
      expect(HealCapitalEffect.parse(e)).toEqual(e);
      expect(Effect.parse(e).kind).toBe('heal-capital');
    });
    it('rejects target other than self', () => {
      expect(() =>
        HealCapitalEffect.parse({ kind: 'heal-capital', amount: 1, target: 'opponent' }),
      ).toThrow();
    });
    it('rejects amount < 1', () => {
      expect(() =>
        HealCapitalEffect.parse({ kind: 'heal-capital', amount: 0, target: 'self' }),
      ).toThrow();
    });
  });

  describe('gain-temporary-resource', () => {
    it('parses a valid gain', () => {
      const e = {
        kind: 'gain-temporary-resource',
        resource: 'wood',
        count: 1,
        source: 'this-card',
      };
      expect(GainTemporaryResourceEffect.parse(e)).toEqual(e);
      expect(Effect.parse(e).kind).toBe('gain-temporary-resource');
    });
    it('rejects unknown resource', () => {
      expect(() =>
        GainTemporaryResourceEffect.parse({
          kind: 'gain-temporary-resource',
          resource: 'mithril',
          count: 1,
          source: 'this-card',
        }),
      ).toThrow();
    });
    it('rejects source other than this-card', () => {
      expect(() =>
        GainTemporaryResourceEffect.parse({
          kind: 'gain-temporary-resource',
          resource: 'gold',
          count: 1,
          source: 'opponent-card',
        }),
      ).toThrow();
    });
  });

  describe('buff-unit-stat', () => {
    it('parses a positive buff', () => {
      const e = {
        kind: 'buff-unit-stat',
        target: { kind: 'unit', unitId: someUnitId },
        stat: 'melee',
        delta: 2,
        duration: 'end-of-turn',
      };
      expect(BuffUnitStatEffect.parse(e)).toEqual(e);
      expect(Effect.parse(e).kind).toBe('buff-unit-stat');
    });
    it('allows a negative delta (debuff)', () => {
      const e = {
        kind: 'buff-unit-stat',
        target: { kind: 'units-by-class', classFilter: 'cavalry', ownership: 'opponent' },
        stat: 'ranged',
        delta: -1,
        duration: 'end-of-turn',
      };
      expect(BuffUnitStatEffect.parse(e)).toEqual(e);
    });
    it('rejects delta === 0', () => {
      expect(() =>
        BuffUnitStatEffect.parse({
          kind: 'buff-unit-stat',
          target: 'self-capital',
          stat: 'health',
          delta: 0,
          duration: 'end-of-turn',
        }),
      ).toThrow();
    });
    it('rejects unknown stat', () => {
      expect(() =>
        BuffUnitStatEffect.parse({
          kind: 'buff-unit-stat',
          target: 'self-capital',
          stat: 'morale',
          delta: 1,
          duration: 'end-of-turn',
        }),
      ).toThrow();
    });
    it('rejects unknown duration', () => {
      expect(() =>
        BuffUnitStatEffect.parse({
          kind: 'buff-unit-stat',
          target: 'self-capital',
          stat: 'melee',
          delta: 1,
          duration: 'permanent',
        }),
      ).toThrow();
    });
  });

  describe('Effect union dispatch', () => {
    it('rejects an unknown verb kind', () => {
      expect(() => Effect.parse({ kind: 'teleport', count: 1 })).toThrow();
    });
  });

  describe('Target taxonomy', () => {
    it('parses each variant', () => {
      expect(Target.parse('self-capital')).toBe('self-capital');
      expect(Target.parse('opponent-capital')).toBe('opponent-capital');
      expect(Target.parse({ kind: 'unit', unitId: someUnitId })).toEqual({
        kind: 'unit',
        unitId: someUnitId,
      });
      expect(Target.parse({ kind: 'all-own-units' })).toEqual({ kind: 'all-own-units' });
      expect(
        Target.parse({ kind: 'all-own-units', classFilter: 'infantry' }),
      ).toEqual({ kind: 'all-own-units', classFilter: 'infantry' });
      expect(
        Target.parse({
          kind: 'units-by-class',
          classFilter: 'cavalry',
          ownership: 'own',
        }),
      ).toEqual({ kind: 'units-by-class', classFilter: 'cavalry', ownership: 'own' });
    });
    it('requires classFilter on units-by-class', () => {
      expect(() =>
        Target.parse({ kind: 'units-by-class', ownership: 'own' }),
      ).toThrow();
    });
    it('rejects unknown ownership on units-by-class', () => {
      expect(() =>
        Target.parse({
          kind: 'units-by-class',
          classFilter: 'cavalry',
          ownership: 'neutral',
        }),
      ).toThrow();
    });
  });

  // ── MVP-6 S2 (#98) ─────────────────────────────────────────────────

  describe('attach-keyword', () => {
    it('parses a valid attachment to a unit', () => {
      const e = {
        kind: 'attach-keyword',
        target: { kind: 'unit', unitId: someUnitId },
        keyword: 'first-strike',
      };
      expect(AttachKeywordEffect.parse(e)).toEqual(e);
      expect(Effect.parse(e).kind).toBe('attach-keyword');
    });
    it('rejects a non-unit target (capital)', () => {
      expect(() =>
        AttachKeywordEffect.parse({
          kind: 'attach-keyword',
          target: 'self-capital',
          keyword: 'first-strike',
        }),
      ).toThrow();
    });
    it('rejects a class-set target', () => {
      expect(() =>
        AttachKeywordEffect.parse({
          kind: 'attach-keyword',
          target: { kind: 'all-own-units' },
          keyword: 'pierce',
        }),
      ).toThrow();
    });
    it('rejects an empty keyword', () => {
      expect(() =>
        AttachKeywordEffect.parse({
          kind: 'attach-keyword',
          target: { kind: 'unit', unitId: someUnitId },
          keyword: '',
        }),
      ).toThrow();
    });
  });

  describe('class-wide-passive', () => {
    it('parses a stat-delta modifier', () => {
      const e = {
        kind: 'class-wide-passive',
        classFilter: 'infantry',
        ownership: 'own',
        modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
      };
      expect(ClassWidePassiveEffect.parse(e)).toEqual(e);
      expect(Effect.parse(e).kind).toBe('class-wide-passive');
    });
    it('parses a keyword modifier', () => {
      const e = {
        kind: 'class-wide-passive',
        classFilter: 'cavalry',
        ownership: 'all',
        modifier: { kind: 'keyword', keyword: 'charge' },
      };
      expect(ClassWidePassiveEffect.parse(e)).toEqual(e);
    });
    it('accepts opponent ownership', () => {
      const e = {
        kind: 'class-wide-passive',
        classFilter: 'archers',
        ownership: 'opponent',
        modifier: { kind: 'stat-delta', stat: 'ranged', delta: -1 },
      };
      expect(ClassWidePassiveEffect.parse(e)).toEqual(e);
    });
    it('rejects unknown ownership', () => {
      expect(() =>
        ClassWidePassiveEffect.parse({
          kind: 'class-wide-passive',
          classFilter: 'infantry',
          ownership: 'neutral',
          modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
        }),
      ).toThrow();
    });
    it('rejects empty classFilter', () => {
      expect(() =>
        ClassWidePassiveEffect.parse({
          kind: 'class-wide-passive',
          classFilter: '',
          ownership: 'own',
          modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
        }),
      ).toThrow();
    });
    it('rejects stat-delta with delta === 0', () => {
      expect(() =>
        ClassWidePassiveEffect.parse({
          kind: 'class-wide-passive',
          classFilter: 'infantry',
          ownership: 'own',
          modifier: { kind: 'stat-delta', stat: 'melee', delta: 0 },
        }),
      ).toThrow();
    });
    it('rejects unknown modifier kind', () => {
      expect(() =>
        ClassWidePassiveEffect.parse({
          kind: 'class-wide-passive',
          classFilter: 'infantry',
          ownership: 'own',
          modifier: { kind: 'cost-reduction', amount: 1 },
        }),
      ).toThrow();
    });
  });
});
