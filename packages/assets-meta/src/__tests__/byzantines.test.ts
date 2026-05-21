import { describe, expect, it } from 'vitest';
import { Card } from '@eoe/schema';
import { loadCivMeta } from '../index.js';

describe("loadCivMeta('byzantines') — placeholder stub for issue #11", () => {
  const cards = loadCivMeta('byzantines');

  it('returns exactly 2 entries (one civ stub + one unit placeholder)', () => {
    expect(cards).toHaveLength(2);
  });

  it('every entry parses against the Card schema', () => {
    // Loader already throws on bad data, but assert explicitly so the
    // test fails loudly instead of via an uncaught import-time exception.
    for (const card of cards) {
      expect(Card.safeParse(card).success).toBe(true);
    }
  });

  it('contains a civilization card with civId="byzantines"', () => {
    const civCard = cards.find((c) => c.kind === 'civilization');
    expect(civCard).toBeDefined();
    if (civCard?.kind === 'civilization') {
      expect(civCard.civId).toBe('byzantines');
    }
  });

  it('contains a unit card flagged as placeholder in flavor', () => {
    const unitCard = cards.find((c) => c.kind === 'unit');
    expect(unitCard).toBeDefined();
    if (unitCard?.kind === 'unit') {
      expect(unitCard.flavor ?? '').toMatch(/placeholder/i);
    }
  });

  it('placeholder unit has the documented stub stats (cost 1 wild, melee 1, health 2)', () => {
    const unitCard = cards.find((c) => c.kind === 'unit');
    expect(unitCard).toBeDefined();
    if (unitCard?.kind === 'unit') {
      expect(unitCard.cost).toEqual({ wild: 1 });
      expect(unitCard.melee).toBe(1);
      expect(unitCard.ranged).toBe(0);
      expect(unitCard.health).toBe(2);
      expect(unitCard.class).toContain('placeholder');
    }
  });
});

describe('loadCivMeta — uningested civs', () => {
  it('returns an empty array for civs with no data file yet', () => {
    expect(loadCivMeta('mongols')).toEqual([]);
    expect(loadCivMeta('hre')).toEqual([]);
  });
});
