// ─────────────────────────── Deterministic shuffle ─────────────────
//
// Pure Fisher–Yates using an injected RNG. Lives in `@eoe/rules` so
// the worker and any other consumer can shuffle deterministically
// against the same seeded stream used by the rest of the engine.

/**
 * Returns a new array — input is never mutated. The caller supplies a
 * `() => number` RNG (typically `mulberry32(seedFor(...))`) so the same
 * inputs always produce the same order.
 */
export function shuffleWith<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const ai = out[i];
    const aj = out[j];
    // Guards unreachable — `i` and `j` are within bounds — but
    // `noUncheckedIndexedAccess` requires the narrowing.
    if (ai === undefined || aj === undefined) continue;
    out[i] = aj;
    out[j] = ai;
  }
  return out;
}
