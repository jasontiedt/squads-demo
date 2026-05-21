import { describe, it, expect } from 'vitest';
import { parseHash, buildHash } from '../router/hash.js';

describe('parseHash', () => {
  it('returns home for empty hash', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
  });

  it('parses /g/CODE as lobby route, normalising to uppercase', () => {
    expect(parseHash('#/g/abc12')).toEqual({
      name: 'lobby',
      gameCode: 'ABC12',
    });
    expect(parseHash('#/g/STUB42')).toEqual({
      name: 'lobby',
      gameCode: 'STUB42',
    });
  });

  it('falls back to home for malformed lobby paths', () => {
    expect(parseHash('#/g/')).toEqual({ name: 'home' });
    expect(parseHash('#/g/!!!')).toEqual({ name: 'home' });
    expect(parseHash('#/g/TOOLONGCODE')).toEqual({ name: 'home' });
  });

  it('builds hashes from routes', () => {
    expect(buildHash({ name: 'home' })).toBe('#/');
    expect(buildHash({ name: 'lobby', gameCode: 'AB12' })).toBe('#/g/AB12');
  });
});
