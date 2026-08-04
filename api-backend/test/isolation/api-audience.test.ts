/**
 * Public REST API audience segregation (spec §8A, non-negotiable #11): a key used against the
 * WRONG namespace is rejected with 403 by middleware, before any handler. Pure test of the
 * `requireAudience` guard.
 */
import { describe, it, expect } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAudience } from '../../src/surfaces/public-api/auth.js';
import type { ApiKeyIdentity, ApiAudience } from '../../src/middleware/types.js';
import { AppError } from '../../src/lib/http/errors.js';

function fakeReq(audience: ApiAudience): Request {
  const identity: ApiKeyIdentity = {
    surface: 'public-api',
    audience,
    networkId: 'net-1',
    ownerId: 'own-1',
    keyId: 'key-1',
    scopes: [],
  };
  return { identity } as unknown as Request;
}

function run(guardAudience: ApiAudience, keyAudience: ApiAudience): AppError | undefined {
  let captured: unknown;
  const next: NextFunction = (err?: unknown) => {
    captured = err;
  };
  requireAudience(guardAudience)(fakeReq(keyAudience), {} as Response, next);
  return captured instanceof AppError ? captured : undefined;
}

describe('requireAudience', () => {
  const audiences: ApiAudience[] = ['advertiser', 'publisher', 'network'];

  it('allows a key on its own namespace', () => {
    for (const a of audiences) {
      expect(run(a, a)).toBeUndefined();
    }
  });

  it('rejects every wrong-namespace combination with 403', () => {
    for (const guard of audiences) {
      for (const key of audiences) {
        if (guard === key) continue;
        const err = run(guard, key);
        expect(err).toBeInstanceOf(AppError);
        expect(err?.status).toBe(403);
        expect(err?.code).toBe('forbidden');
      }
    }
  });

  it('rejects when no identity is present (deny-by-default)', () => {
    let captured: unknown;
    requireAudience('network')({} as Request, {} as Response, (e?: unknown) => {
      captured = e;
    });
    expect(captured).toBeInstanceOf(AppError);
    expect((captured as AppError).status).toBe(401);
  });
});
