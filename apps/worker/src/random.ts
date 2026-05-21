// ─────────────────────────── Crypto / random helpers ────────────────
//
// The Worker is the only place randomness enters the system. The rules
// engine (`@eoe/rules`) is pure and seeded; this module produces the
// seeds, tokens, and codes that feed it.
//
// All randomness sourced from `crypto.getRandomValues`. `crypto.subtle`
// is used for SHA-256 hashing. Both are part of the Workers runtime
// (Web Crypto API).

/**
 * Game-code alphabet — 32 characters, omitting visually ambiguous
 * symbols (I, O, L, 0, 1). 32^6 ≈ 1.07B codes → collisions vanishingly
 * rare in practice, but the create-game flow still checks and retries.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** Random uppercase 6-char game code using the unambiguous alphabet. */
export function newGameCode(): string {
  const buf = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const byte = buf[i] ?? 0;
    const idx = byte % CODE_ALPHABET.length;
    out += CODE_ALPHABET.charAt(idx);
  }
  return out;
}

/**
 * 32-byte player token, base64url-encoded (no padding). Returned to the
 * client once; the server only ever persists the SHA-256 hash.
 *
 * 32 bytes → 43 base64url chars, comfortably above the schema's
 * `PlayerToken = z.string().min(32)`.
 */
export function newPlayerToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

/**
 * Game seed — 4 random bytes encoded as 8 hex chars. Stored on
 * `GameState.seed` (branded string). Same value drives every
 * deterministic stream via `seedFor(state, salt)` from `@eoe/rules`.
 */
export function newSeed(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] ?? 0;
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * SHA-256 of a UTF-8 string → lowercase hex digest. Workers runtime
 * provides `crypto.subtle.digest`.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(hashBuf);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    const b = view[i] ?? 0;
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Deterministic Fisher–Yates shuffle. The caller supplies a uint32 seed
 * derived from the game state via `@eoe/rules`'s `seedFor` so the same
 * inputs always produce the same order — critical for reproducible
 * games and tests.
 *
 * Pure: returns a new array; input untouched.
 */
export function shuffleWith<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const ai = out[i];
    const aj = out[j];
    // `noUncheckedIndexedAccess` — guards are unreachable because
    // `i` and `j` are within bounds, but the type system requires them.
    if (ai === undefined || aj === undefined) continue;
    out[i] = aj;
    out[j] = ai;
  }
  return out;
}

// ─────────────────────────── base64url ───────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  // Workers runtime has `btoa`. Convert bytes → binary string → base64
  // → url-safe alphabet → strip padding.
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
