// TODO: replace with real Byzantine data after #17 (image-only PDF OCR)
//
// `loadCivMeta(civ)` returns an array of fully-validated `Card` records
// (the Zod-discriminated-union type from `@eoe/schema`). Card data lives
// in hand-curated JSON files at `data/{civ}.json` with the shape:
//
//   { "_meta": { ... documentation ... }, "cards": [ Card, ... ] }
//
// The `_meta` block documents placeholder status, owners, and blockers
// for human readers — it is intentionally outside the Card schema so it
// never has to satisfy the discriminated union. The loader reads
// `data.cards` only and validates each entry against `Card` at load
// time; an unparseable entry throws (loud failure beats silent drift).
//
// Loader API note: this replaces the original stub `CardMeta` shape that
// shipped in the scaffold (PR landing the monorepo). Nothing consumed
// `CardMeta` yet, so the swap to `Card` is non-breaking. See PR body for
// rationale and the issue #10 (English) follow-up.

import { Card, type Civ } from '@eoe/schema';

// Per-civ JSON imports. Adding a civ:
//   1. Drop a `data/{civ}.json` file matching `CivData`.
//   2. Add a `case '{civ}':` below.
//   3. Add a test under `src/__tests__/{civ}.test.ts`.
//
// Civs not yet ingested return `[]` — the loader is total over `Civ`.
// NOTE: Plain JSON import (no `with { type: 'json' }` attribute). The
// attribute syntax is ES2025; wrangler's bundled esbuild (v3.x) can't
// parse it. TypeScript `resolveJsonModule` covers us in all of vitest,
// Vite, and wrangler dev.
import byzantinesData from '../data/byzantines.json';
import englishData from '../data/english.json';

type CivData = {
  _meta: unknown;
  cards: unknown[];
};

/**
 * Load the validated card list for a civilization.
 *
 * @throws if any card in the source JSON fails `Card.parse`. We prefer a
 *   loud throw over silent drift — bad card data is a developer bug, not
 *   a runtime concern.
 */
export function loadCivMeta(civ: Civ): readonly Card[] {
  const raw = pickRaw(civ);
  if (raw === null) {
    return [];
  }
  return raw.cards.map((entry) => Card.parse(entry));
}

function pickRaw(civ: Civ): CivData | null {
  switch (civ) {
    case 'byzantines':
      // TODO: replace with real Byzantine data after #17 (image-only PDF OCR)
      return byzantinesData satisfies CivData;
    case 'english':
      // MVP card subset (issue #10). Cost decomposition flagged for #17.
      return englishData satisfies CivData;
    case 'hre':
    case 'mongols':
    case 'norsemen':
    case 'ottomans':
    case 'scots':
      return null;
  }
}
