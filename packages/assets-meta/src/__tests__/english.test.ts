import { describe, expect, it } from 'vitest';
import { Card } from '@eoe/schema';
import { loadCivMeta } from '../index.js';
import englishData from '../../data/english.json' with { type: 'json' };

const EXPECTED_OCR_UNIT_NAMES = [
  'Watchman',
  'Billman',
  'Welsh Infantry',
  'Longbowman',
  'Esquire',
  'English Knight',
] as const;

describe("loadCivMeta('english') — MVP card subset for issue #10 + #41 stubs", () => {
  const cards = loadCivMeta('english');

  it('returns exactly 20 cards (6 OCR + 14 MVP-2 playtest stubs from #41)', () => {
    expect(cards).toHaveLength(20);
  });

  it('every entry parses against the Card schema', () => {
    for (const card of cards) {
      expect(Card.safeParse(card).success).toBe(true);
    }
  });

  it('every entry is on the English civ', () => {
    for (const card of cards) {
      expect(card.civ).toBe('english');
    }
  });

  it('contains all 6 OCR-decoded unit names alongside the stubs', () => {
    const names = cards.map((c) => c.name);
    for (const expected of EXPECTED_OCR_UNIT_NAMES) {
      expect(names).toContain(expected);
    }
  });

  it('every entry has a stable string id and imageRef under english/', () => {
    for (const card of cards) {
      expect(typeof card.id).toBe('string');
      expect(String(card.id).length).toBeGreaterThan(0);
      expect(card.imageRef).toBeDefined();
      expect(card.imageRef).toMatch(/^english\/.+\.png$/);
    }
  });

  it('mixes card kinds (units plus at least one non-unit) for MVP-2 schema coverage', () => {
    const kinds = new Set(cards.map((c) => c.kind));
    expect(kinds.has('unit')).toBe(true);
    expect(kinds.size).toBeGreaterThan(1);
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

  it('archer units have ranged > 0; pure infantry / cavalry units have ranged 0', () => {
    const byName = new Map(cards.map((c) => [c.name, c]));
    const longbow = byName.get('Longbowman');
    const welsh = byName.get('Welsh Infantry');
    const billman = byName.get('Billman');
    const knight = byName.get('English Knight');
    expect(longbow && longbow.kind === 'unit' && longbow.ranged > 0).toBe(true);
    expect(welsh && welsh.kind === 'unit' && welsh.ranged > 0).toBe(true);
    expect(billman && billman.kind === 'unit' && billman.ranged === 0).toBe(true);
    expect(knight && knight.kind === 'unit' && knight.ranged === 0).toBe(true);
  });

  it('English Knight has the highest melee + health among the original 6 OCR units (heavy hitter check)', () => {
    const ocrUnits = cards.filter(
      (c) => c.kind === 'unit' && (EXPECTED_OCR_UNIT_NAMES as readonly string[]).includes(c.name),
    );
    const knight = ocrUnits.find((c) => c.name === 'English Knight');
    expect(knight).toBeDefined();
    if (knight?.kind !== 'unit') return;
    for (const other of ocrUnits) {
      if (other.kind !== 'unit' || other.name === 'English Knight') continue;
      expect(knight.melee + knight.health).toBeGreaterThan(other.melee + other.health);
    }
  });
});

describe('english.json — _meta documentation surface', () => {
  it('exposes a non-empty needs_confirmation list so #17 has a concrete TODO surface', () => {
    const meta = (englishData as { _meta?: { needs_confirmation?: unknown[] } })._meta;
    expect(meta?.needs_confirmation).toBeDefined();
    expect(Array.isArray(meta?.needs_confirmation)).toBe(true);
    expect((meta?.needs_confirmation ?? []).length).toBeGreaterThan(0);
  });

  it('every needs_confirmation entry references a real card id', () => {
    const meta = (englishData as {
      _meta: { needs_confirmation: ReadonlyArray<{ card: string; field: string; note: string }> };
      cards: ReadonlyArray<{ id: string }>;
    })._meta;
    const knownIds = new Set(englishData.cards.map((c) => c.id));
    for (const flag of meta.needs_confirmation) {
      expect(knownIds.has(flag.card)).toBe(true);
      expect(flag.field.length).toBeGreaterThan(0);
      expect(flag.note.length).toBeGreaterThan(0);
    }
  });

  it('flags every cards cost.breakdown for #17 follow-up', () => {
    const meta = (englishData as {
      _meta: { needs_confirmation: ReadonlyArray<{ card: string; field: string }> };
    })._meta;
    const costFlaggedCards = new Set(
      meta.needs_confirmation.filter((f) => f.field === 'cost.breakdown').map((f) => f.card),
    );
    // All 6 cards have cost ambiguity per the OCR situation; documented in _meta.stats_confidence.cost.
    expect(costFlaggedCards.size).toBe(6);
  });
});
