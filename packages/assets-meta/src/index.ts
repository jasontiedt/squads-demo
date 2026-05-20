import type { Civ } from '@eoe/schema';

/**
 * Hand-curated card metadata. Sabine owns ingestion from echoesofemperors.com.
 * Real data files land at `data/{civ}.json` — this package re-exports them.
 */
export type CardMeta = {
  id: string;
  civ: Civ;
  name: string;
  type: string;
  cost?: number;
  text?: string;
  image?: string;
};

/**
 * Stub loader. Sabine replaces this with real JSON imports once English ingest lands.
 */
export function loadCivMeta(_civ: Civ): CardMeta[] {
  return [];
}
