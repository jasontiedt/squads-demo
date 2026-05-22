import { describe, expect, it } from 'vitest';
import {
  ResourceKind,
  ResourceToken,
  ResourceTokenId,
  TemporaryResource,
  TemporaryResourceId,
} from '../index.js';

describe('ResourceKind', () => {
  it('accepts every documented kind', () => {
    for (const k of ['wood', 'food', 'gold', 'wild'] as const) {
      expect(ResourceKind.parse(k)).toBe(k);
    }
  });

  it('rejects unknown kinds', () => {
    expect(ResourceKind.safeParse('iron').success).toBe(false);
    expect(ResourceKind.safeParse('').success).toBe(false);
    expect(ResourceKind.safeParse(undefined).success).toBe(false);
  });
});

describe('ResourceTokenId', () => {
  it('parses and brands a non-empty string', () => {
    const id = ResourceTokenId.parse('tok-1');
    // Branded type: assignable to string at runtime, distinct at the type level.
    expect(typeof id).toBe('string');
    expect(id).toBe('tok-1');
  });

  it('rejects an empty string', () => {
    expect(ResourceTokenId.safeParse('').success).toBe(false);
  });
});

describe('ResourceToken', () => {
  const baseId = ResourceTokenId.parse('tok-wood-1');

  it('round-trips a fresh unexhausted Camp token', () => {
    const token = {
      id: baseId,
      kind: 'wood' as const,
      exhausted: false,
      sourceCampId: 'camp-forest-1',
    };
    expect(ResourceToken.parse(token)).toEqual(token);
  });

  it('exhaust → unexhaust round-trip preserves identity and source', () => {
    const fresh = ResourceToken.parse({
      id: baseId,
      kind: 'food',
      exhausted: false,
      sourceCampId: 'camp-farm-1',
    });

    const spent = ResourceToken.parse({ ...fresh, exhausted: true });
    expect(spent.exhausted).toBe(true);
    expect(spent.id).toBe(fresh.id);
    expect(spent.sourceCampId).toBe('camp-farm-1');

    const refreshed = ResourceToken.parse({ ...spent, exhausted: false });
    expect(refreshed).toEqual(fresh);
  });

  it('accepts a non-camp token (e.g. starting wild) with no sourceCampId', () => {
    const wild = {
      id: ResourceTokenId.parse('tok-wild-start'),
      kind: 'wild' as const,
      exhausted: false,
    };
    const parsed = ResourceToken.parse(wild);
    expect(parsed.sourceCampId).toBeUndefined();
    expect(parsed.kind).toBe('wild');
  });

  it('rejects a token with an empty sourceCampId', () => {
    // exactOptionalPropertyTypes is enforced at the schema level: the field
    // is optional, but if present it must be a non-empty string.
    const bad = {
      id: baseId,
      kind: 'wood',
      exhausted: false,
      sourceCampId: '',
    };
    expect(ResourceToken.safeParse(bad).success).toBe(false);
  });

  it('rejects a token with an empty id', () => {
    expect(
      ResourceToken.safeParse({
        id: '',
        kind: 'wood',
        exhausted: false,
      }).success,
    ).toBe(false);
  });

  it('rejects a token with a non-boolean exhausted flag', () => {
    expect(
      ResourceToken.safeParse({
        id: baseId,
        kind: 'wood',
        exhausted: 'no',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown kind', () => {
    expect(
      ResourceToken.safeParse({
        id: baseId,
        kind: 'iron',
        exhausted: false,
      }).success,
    ).toBe(false);
  });
});

describe('TemporaryResource', () => {
  const tempId = TemporaryResourceId.parse('temp-1');

  it('round-trips a capped temporary pool with current ≤ max', () => {
    const t = {
      id: tempId,
      kind: 'wood' as const,
      attachedToCardId: 'card-action-7',
      max: 3,
      current: 2,
    };
    expect(TemporaryResource.parse(t)).toEqual(t);
  });

  it('round-trips a temporary pool with no max (uncapped)', () => {
    const t = {
      id: tempId,
      kind: 'gold' as const,
      attachedToCardId: 'card-civ',
      current: 0,
    };
    const parsed = TemporaryResource.parse(t);
    expect(parsed.max).toBeUndefined();
    expect(parsed.current).toBe(0);
  });

  it('accepts current === max (boundary, not overflow)', () => {
    expect(
      TemporaryResource.safeParse({
        id: tempId,
        kind: 'food',
        attachedToCardId: 'card-1',
        max: 2,
        current: 2,
      }).success,
    ).toBe(true);
  });

  it('rejects current > max (overflow)', () => {
    const bad = TemporaryResource.safeParse({
      id: tempId,
      kind: 'food',
      attachedToCardId: 'card-1',
      max: 2,
      current: 3,
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues[0]?.message).toBe('current cannot exceed max');
    }
  });

  it('rejects negative current', () => {
    expect(
      TemporaryResource.safeParse({
        id: tempId,
        kind: 'food',
        attachedToCardId: 'card-1',
        current: -1,
      }).success,
    ).toBe(false);
  });

  it('rejects non-integer current', () => {
    expect(
      TemporaryResource.safeParse({
        id: tempId,
        kind: 'food',
        attachedToCardId: 'card-1',
        current: 1.5,
      }).success,
    ).toBe(false);
  });

  it('rejects zero or negative max', () => {
    for (const max of [0, -1]) {
      expect(
        TemporaryResource.safeParse({
          id: tempId,
          kind: 'food',
          attachedToCardId: 'card-1',
          max,
          current: 0,
        }).success,
      ).toBe(false);
    }
  });

  it('rejects an empty attachedToCardId', () => {
    expect(
      TemporaryResource.safeParse({
        id: tempId,
        kind: 'food',
        attachedToCardId: '',
        current: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects an empty id', () => {
    expect(
      TemporaryResource.safeParse({
        id: '',
        kind: 'food',
        attachedToCardId: 'card-1',
        current: 0,
      }).success,
    ).toBe(false);
  });
});
