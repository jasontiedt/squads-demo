import { describe, expect, it } from 'vitest';
import worker from '../index.js';

const env = { ALLOWED_ORIGINS: 'http://localhost:5173' };

describe('worker CORS preflight', () => {
  it('responds 204 with CORS headers on OPTIONS', async () => {
    const req = new Request('http://example.com/games', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    // @ts-expect-error — test stub for ExecutionContext
    const res = await worker.fetch(req, env, {});
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
