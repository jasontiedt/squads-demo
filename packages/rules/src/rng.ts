// ─────────────────────────── Seeded PRNG ────────────────────────────
//
// Issue #7: small deterministic PRNG for the rules engine. NO use of
// `Math.random`, `crypto`, or `Date.now`. Every random draw must be
// reproducible from `state.seed` + per-call salt.
//
// We provide two pieces:
//
//   1. `mulberry32(seed)` — classic ~10-line uint32 PRNG. Returns a
//      function that yields a float in [0, 1). Same seed → same stream.
//
//   2. `seedFor(state, salt)` — mixes `state.seed`, `state.turn`,
//      `state.activePlayer`, and a caller-supplied `salt` (e.g.
//      `'draw'`, `'shuffle:deck'`) into a uint32 suitable for
//      `mulberry32`. Uses FNV-1a 32-bit — no crypto, fully pure.
//
// SEED-MIXING STRATEGY
//   Each random consumer in the engine calls `seedFor(state, '<purpose>')`
//   to derive its own PRNG seed. This means draw-related randomness in
//   turn N for seat S is independent from, say, combat resolution in
//   the same turn — they consume different streams. The `salt` is a
//   free-form string the caller picks; future card effects MUST namespace
//   it (e.g. `'card:eng-action-rally'`) to avoid stream collisions.
//
// Issue #7 itself does not consume randomness — draws are positional
// (top of deck) and hand-cap discards are positional (end of hand). The
// PRNG lives here to give #8+ a ready-made deterministic primitive.

/**
 * Mulberry32 — fast, statistically decent, single-state uint32 PRNG.
 * Stream is fully determined by the initial seed. Returns a closure
 * yielding a float in [0, 1).
 *
 * Reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mix the per-game seed with per-call context into a uint32 for mulberry32.
 * Uses FNV-1a 32-bit hashing — pure, no crypto, no Date.now.
 *
 * The `salt` argument lets callers carve independent streams from the
 * same game state. Pick something stable and unique (e.g. `'draw'`,
 * `'card:foo-bar'`).
 */
export function seedFor(
  state: { readonly seed: string; readonly turn: number; readonly activePlayer: number },
  salt: string,
): number {
  let h = 0x811c9dc5;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  mix(String(state.seed));
  mix('|');
  mix(String(state.turn));
  mix('|');
  mix(String(state.activePlayer));
  mix('|');
  mix(salt);
  return h >>> 0;
}
