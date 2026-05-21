import { describe, it, expect } from 'vitest';
import {
  validateGameCode,
  validateName,
  CIV_OPTIONS,
  isCiv,
  isSeat,
} from '../lib/validation.js';

describe('validateGameCode', () => {
  it('accepts 4–6 uppercase alphanumeric codes', () => {
    expect(validateGameCode('ABCD')).toBeNull();
    expect(validateGameCode('AB12CD')).toBeNull();
    expect(validateGameCode('STUB42')).toBeNull();
  });

  it('rejects empty', () => {
    expect(validateGameCode('')).toMatch(/required/i);
    expect(validateGameCode('   ')).toMatch(/required/i);
  });

  it('rejects lowercase', () => {
    expect(validateGameCode('abcd')).toMatch(/uppercase/i);
  });

  it('rejects wrong length', () => {
    expect(validateGameCode('ABC')).toMatch(/4–6/);
    expect(validateGameCode('ABCDEFG')).toMatch(/4–6/);
  });

  it('rejects symbols', () => {
    expect(validateGameCode('AB-12')).toMatch(/4–6/);
  });
});

describe('validateName', () => {
  it('requires non-empty', () => {
    expect(validateName('')).toMatch(/required/i);
    expect(validateName('   ')).toMatch(/required/i);
  });

  it('caps at 32 chars', () => {
    expect(validateName('a'.repeat(33))).toMatch(/32/);
    expect(validateName('a'.repeat(32))).toBeNull();
  });
});

describe('CIV_OPTIONS', () => {
  it('contains the seven civs from the schema', () => {
    expect(CIV_OPTIONS).toContain('english');
    expect(CIV_OPTIONS).toContain('byzantines');
    expect(CIV_OPTIONS.length).toBe(7);
  });

  it('type guards work', () => {
    expect(isCiv('english')).toBe(true);
    expect(isCiv('nope')).toBe(false);
    expect(isSeat(1)).toBe(true);
    expect(isSeat(5)).toBe(false);
  });
});
