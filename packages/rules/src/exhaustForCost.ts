import type { ResourceToken } from '@eoe/schema';

import { err, ok, type Result } from './result.js';

// ─────────────────────────── Cost payment ────────────────────────────
//
// Shared helper for handlers that pay from permanent resource tokens by
// exhausting them in place (DeployUnit, BuildBarracks, …).

export function exhaustForCost(
  tokens: ReadonlyArray<ResourceToken>,
  cost: Record<string, number | undefined>,
): Result<ResourceToken[]> {
  const exhausted: boolean[] = tokens.map((t) => t.exhausted);

  const findUnexhausted = (kind: string | null): number => {
    for (let i = 0; i < tokens.length; i++) {
      if (exhausted[i] === true) continue;
      const tok = tokens[i];
      if (tok === undefined) continue;
      if (kind === null || tok.kind === kind) return i;
    }
    return -1;
  };

  for (const entry of Object.entries(cost)) {
    const [kind, rawCount] = entry;
    if (kind === 'wild') continue;
    const count = rawCount ?? 0;
    if (count <= 0) continue;
    for (let n = 0; n < count; n++) {
      const idx = findUnexhausted(kind);
      if (idx < 0) {
        return err(
          'insufficient_resources',
          `insufficient ${kind} tokens to pay cost (need ${count})`,
        );
      }
      exhausted[idx] = true;
    }
  }

  const wildNeeded = cost['wild'] ?? 0;
  for (let n = 0; n < wildNeeded; n++) {
    const idx = findUnexhausted(null);
    if (idx < 0) {
      return err(
        'insufficient_resources',
        `insufficient wild tokens to pay cost (need ${wildNeeded})`,
      );
    }
    exhausted[idx] = true;
  }

  return ok(
    tokens.map((t, i) => ({
      ...t,
      exhausted: exhausted[i] ?? t.exhausted,
    })),
  );
}
