import { Card } from '@eoe/schema';
import { describe, expect, it } from 'vitest';
import byzantinesData from '../../data/byzantines.json' with { type: 'json' };
import { loadCivMeta } from '../index.js';

const THEMED_STUB_NAMES = [
  'Cataphract',
  'Varangian Guard',
  'Strategos',
  'Greek Fire',
  'Basileus',
  'Tagmata',
] as const;

describe("loadCivMeta('byzantines') — 20-card stub deck for issue #58 (MVP-3)", () => {
  const cards = loadCivMeta('byzantines');

  it('returns exactly 21 cards (6 themed stubs + 14 generic stubs + 1 e2e fixture: byz-imperial-shield)', () => {
    expect(cards).toHaveLength(21);
  });

  it('every entry parses against the Card schema', () => {
    for (const card of cards) {
      expect(Card.safeParse(card).success).toBe(true);
    }
  });

  it('every entry is on the Byzantines civ', () => {
    for (const card of cards) {
      expect(card.civ).toBe('byzantines');
    }
  });

  it('contains all 6 themed stub names alongside the generic stubs', () => {
    const names = cards.map((c) => c.name);
    for (const expected of THEMED_STUB_NAMES) {
      expect(names).toContain(expected);
    }
  });

  it('every entry has a stable string id and imageRef under byzantines/', () => {
    for (const card of cards) {
      expect(typeof card.id).toBe('string');
      expect(String(card.id).length).toBeGreaterThan(0);
      expect(card.imageRef).toBeDefined();
      expect(card.imageRef).toMatch(/^byzantines\/.+\.png$/);
    }
  });

  it('mixes card kinds across unit / action / tactic / upgrade / technology / event for schema coverage', () => {
    const kinds = new Set(cards.map((c) => c.kind));
    expect(kinds.has('unit')).toBe(true);
    expect(kinds.has('action')).toBe(true);
    expect(kinds.has('tactic')).toBe(true);
    expect(kinds.has('upgrade')).toBe(true);
    expect(kinds.has('technology')).toBe(true);
    expect(kinds.has('event')).toBe(true);
  });

  it('unit stat values are non-negative integers with positive health', () => {
    for (const card of cards) {
      if (card.kind !== 'unit') continue;
      expect(Number.isInteger(card.melee)).toBe(true);
      expect(card.melee).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(card.ranged)).toBe(true);
      expect(card.ranged).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(card.health)).toBe(true);
      expect(card.health).toBeGreaterThan(0);
      expect(card.movement.points).toBeGreaterThanOrEqual(0);
    }
  });

  it('Cataphract has the highest melee + health among Byzantine units (apex heavy cavalry check)', () => {
    const units = cards.filter((c) => c.kind === 'unit');
    const cataphract = units.find((c) => c.name === 'Cataphract');
    expect(cataphract).toBeDefined();
    if (cataphract?.kind !== 'unit') return;
    for (const other of units) {
      if (other.kind !== 'unit' || other.name === 'Cataphract') continue;
      expect(cataphract.melee + cataphract.health).toBeGreaterThanOrEqual(other.melee + other.health);
    }
  });

  it('archer-class units have ranged > 0', () => {
    for (const card of cards) {
      if (card.kind !== 'unit') continue;
      if (card.class.includes('archer')) {
        expect(card.ranged).toBeGreaterThan(0);
      }
    }
  });

  it('persistent events carry persistent === true', () => {
    const events = cards.filter((c) => c.kind === 'event');
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      if (event.kind !== 'event') continue;
      expect(event.persistent).toBe(true);
    }
  });
});

describe('byzantines.json — _meta documentation surface', () => {
  it('exposes a non-empty needs_confirmation list so #17 has a concrete TODO surface', () => {
    const meta = (byzantinesData as { _meta?: { needs_confirmation?: unknown[] } })._meta;
    expect(meta?.needs_confirmation).toBeDefined();
    expect(Array.isArray(meta?.needs_confirmation)).toBe(true);
    expect((meta?.needs_confirmation ?? []).length).toBeGreaterThan(0);
  });

  it('every needs_confirmation entry references a real card id', () => {
    const meta = (byzantinesData as {
      _meta: { needs_confirmation: ReadonlyArray<{ card: string; field: string; note: string }> };
      cards: ReadonlyArray<{ id: string }>;
    })._meta;
    const knownIds = new Set(byzantinesData.cards.map((c) => c.id));
    for (const flag of meta.needs_confirmation) {
      expect(knownIds.has(flag.card)).toBe(true);
      expect(flag.field.length).toBeGreaterThan(0);
      expect(flag.note.length).toBeGreaterThan(0);
    }
  });

  it('flags every card for #17 follow-up (all 20 are stubs)', () => {
    const meta = (byzantinesData as {
      _meta: { needs_confirmation: ReadonlyArray<{ card: string }> };
    })._meta;
    const flaggedCards = new Set(meta.needs_confirmation.map((f) => f.card));
    expect(flaggedCards.size).toBe(20);
  });
});

describe('loadCivMeta — uningested civs', () => {
  it('returns an empty array for civs with no data file yet', () => {
    expect(loadCivMeta('mongols')).toEqual([]);
    expect(loadCivMeta('hre')).toEqual([]);
  });
});
