/**
 * Filter query-string building blocks — PURE tests (no DB). Every list/report filter parses through
 * these, so bad input must fail zod validation (→ 400) rather than reach Postgres (→ 500), and
 * free-text search must not smuggle LIKE wildcards.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { csvList, queryBool, queryDate } from '../../src/lib/http/query-params.js';
import { escapeLike, containsPattern } from '../../src/lib/db/like.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('csvList', () => {
  const ids = csvList(z.string().uuid());

  it('splits a comma list, trims, and de-duplicates', () => {
    expect(ids.parse(`${UUID_A}, ${UUID_B},${UUID_A}`)).toEqual([UUID_A, UUID_B]);
  });

  it('accepts a repeated param (array) and comma lists inside it', () => {
    expect(ids.parse([UUID_A, `${UUID_B},${UUID_A}`])).toEqual([UUID_A, UUID_B]);
  });

  it('treats missing / empty / only-commas as undefined', () => {
    expect(ids.parse(undefined)).toBeUndefined();
    expect(ids.parse('')).toBeUndefined();
    expect(ids.parse(' , ,')).toBeUndefined();
  });

  it('rejects any invalid item', () => {
    expect(ids.safeParse(`${UUID_A},not-a-uuid`).success).toBe(false);
    expect(ids.safeParse("1' OR '1'='1").success).toBe(false);
  });

  it('works with enum items', () => {
    const statuses = csvList(z.enum(['active', 'paused']));
    expect(statuses.parse('active,paused')).toEqual(['active', 'paused']);
    expect(statuses.safeParse('active,deleted').success).toBe(false);
  });

  it('caps the list length', () => {
    const many = Array.from({ length: 201 }, (_, i) => `v${i}`).join(',');
    expect(csvList(z.string()).safeParse(many).success).toBe(false);
  });
});

describe('queryBool', () => {
  it('parses true/1 and false/0 (case-insensitive)', () => {
    expect(queryBool.parse('true')).toBe(true);
    expect(queryBool.parse('TRUE')).toBe(true);
    expect(queryBool.parse('1')).toBe(true);
    expect(queryBool.parse('false')).toBe(false);
    expect(queryBool.parse('0')).toBe(false);
  });

  it('uses the first value of a repeated param', () => {
    expect(queryBool.parse(['false', 'true'])).toBe(false);
  });

  it('treats missing / empty as undefined', () => {
    expect(queryBool.parse(undefined)).toBeUndefined();
    expect(queryBool.parse('')).toBeUndefined();
  });

  it('rejects anything else (z.coerce.boolean would have said true)', () => {
    expect(queryBool.safeParse('yes').success).toBe(false);
    expect(queryBool.safeParse('2').success).toBe(false);
  });
});

describe('queryDate', () => {
  it('accepts YYYY-MM-DD and ISO datetimes', () => {
    for (const ok of ['2026-01-31', '2026-01-31T23:59:59.999Z', '2026-01-31T00:00:00+05:30', '2026-01-31 10:00:00Z']) {
      expect(queryDate.safeParse(ok).success, ok).toBe(true);
    }
  });

  it('rejects non-dates, junk suffixes and impossible months', () => {
    for (const bad of ['', 'yesterday', '2026-1-5', '2026-13-01', "2026-01-01'; DROP TABLE x;--", '01/31/2026', '2026-01-31Tnope']) {
      expect(queryDate.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('escapeLike / containsPattern', () => {
  it('escapes %, _ and backslash', () => {
    expect(escapeLike('50%_off\\now')).toBe('50\\%\\_off\\\\now');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike("O'Brien Media")).toBe("O'Brien Media");
    expect(escapeLike('')).toBe('');
  });

  it('wraps the escaped term for a contains search', () => {
    expect(containsPattern('a%b')).toBe('%a\\%b%');
    expect(containsPattern('%')).toBe('%\\%%');
  });
});
