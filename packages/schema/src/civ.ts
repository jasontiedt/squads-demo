import { z } from 'zod';

/**
 * The set of civilizations playable in MVP-1.
 *
 * Lives in its own leaf file (rather than `index.ts`) so that the cards
 * schema can import it without creating a `cards.ts` ↔ `index.ts` cycle.
 * Re-exported from `index.ts` for stable consumer imports.
 */
export const Civ = z.enum([
  'byzantines',
  'hre',
  'mongols',
  'norsemen',
  'ottomans',
  'scots',
  'english',
]);
export type Civ = z.infer<typeof Civ>;
