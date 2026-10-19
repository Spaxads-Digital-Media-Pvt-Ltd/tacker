/**
 * Automation building blocks (audit F-17a) — no DB.
 *  - Alert-rule conditions: the grammar the worker evaluates (and the API validates), and how a
 *    report row is judged (money compared exactly as decimals; cr / invalid_rate as percentages).
 *  - Webhook events: normalised to the known list, or `*`.
 *  - Scheduled actions: what can't run (archive / cap_change for partners, cap_change without a cap).
 */
import { describe, it, expect } from 'vitest';
import { parseConditions, clausesHold, ruleValues } from '../../src/lib/automation/alert-rules.js';
import { parseWebhookEvents } from '../../src/lib/automation/webhooks.js';
import { scheduledActionProblem, scheduledActionParams } from '../../src/lib/automation/scheduled-actions.js';

describe('alert-rule conditions', () => {
  it('reads clauses, scope and window (defaults: network-wide, 24h)', () => {
    expect(parseConditions('clicks >= 100')).toEqual({ clauses: [{ metric: 'clicks', op: '>=', value: '100' }], scope: null, windowMinutes: 1440 });
    expect(parseConditions('CR > 5% AND clicks >= 100 per offer in 6h')).toEqual({
      clauses: [{ metric: 'cr', op: '>', value: '5' }, { metric: 'clicks', op: '>=', value: '100' }], scope: 'offer', windowMinutes: 360,
    });
    expect(parseConditions('conversion rate < 1.5 per partner over the last 30 minutes')).toMatchObject({
      clauses: [{ metric: 'cr', op: '<', value: '1.5' }], scope: 'publisher', windowMinutes: 30,
    });
    expect(parseConditions('profit < 0 && fraud_rate >= 20% per advertiser in 7d')).toMatchObject({
      clauses: [{ metric: 'margin', op: '<', value: '0' }, { metric: 'invalid_rate', op: '>=', value: '20' }], scope: 'advertiser', windowMinutes: 10080,
    });
    expect(parseConditions('revenue == 10.25')).toMatchObject({ clauses: [{ metric: 'revenue', op: '=', value: '10.25' }] });
  });

  it.each([
    ['', /Conditions look like/],
    ['whatever happens', /Can't read "whatever happens"/],
    ['bananas > 5', /Can't read "bananas > 5"/],
    ['clicks > 5%', /"%" only applies to cr and invalid_rate/],
    ['clicks > 2.5', /clicks is a count/],
    ['payout > 1.12345', /at most 4 decimals/],
    ['clicks > 1 in 2m', /between 5m and 30d/],
    ['clicks > 1 in 31d', /between 5m and 30d/],
    ['clicks > 1 and clicks > 2 and clicks > 3 and clicks > 4 and clicks > 5 and clicks > 6', /Conditions look like/],
  ])('refuses %j', (raw, msg) => {
    const r = parseConditions(raw);
    expect('error' in r && r.error).toMatch(msg);
  });

  it('judges a report row: every clause must hold; money exactly, past 10 integer digits too', () => {
    const v = ruleValues({ clicks: 200, unique_clicks: 150, conversions: 12, invalid_clicks: 50, payout: '19999999999999.8000', revenue: '25.0000', margin: '-0.0001', epc: 0.1 });
    const holds = (raw: string) => {
      const p = parseConditions(raw);
      if ('error' in p) throw new Error(p.error);
      return clausesHold(p.clauses, v);
    };
    expect(holds('cr >= 6')).toBe(true); // 12 / 200 = 6%
    expect(holds('cr > 6')).toBe(false);
    expect(holds('invalid_rate = 25')).toBe(true);
    expect(holds('payout > 19999999999999.7999')).toBe(true);
    expect(holds('payout > 19999999999999.8')).toBe(false);
    expect(holds('margin < 0')).toBe(true);
    expect(holds('clicks >= 200 and conversions != 12')).toBe(false);
    expect(holds('epc >= 0.1 and uniques < 151')).toBe(true);
  });

  it('a row without clicks has 0% cr / invalid rate (no division by zero)', () => {
    expect(ruleValues({ clicks: 0, conversions: 3 })).toMatchObject({ cr: 0, invalid_rate: 0 });
  });
});

describe('webhook events', () => {
  it('normalises the known event names; * means all; unknown ones are reported', () => {
    expect(parseWebhookEvents(' Conversion.Approved, alert.raised;conversion.approved ')).toEqual({ events: ['conversion.approved', 'alert.raised'], unknown: [] });
    expect(parseWebhookEvents('alert.raised *')).toEqual({ events: ['*'], unknown: [] });
    expect(parseWebhookEvents('conversion.approved, offer.deleted')).toEqual({ events: ['conversion.approved'], unknown: ['offer.deleted'] });
    expect(parseWebhookEvents('')).toEqual({ events: [], unknown: [] });
  });
});

describe('scheduled actions', () => {
  it('archive / cap_change are offer-wide; cap_change needs a cap type and value (null removes the cap)', () => {
    const p = (actionType: string, partnerIds: string[] = [], params = {}) => scheduledActionProblem({ actionType, partnerIds, params });
    expect(p('pause')).toBeNull();
    expect(p('activate', ['x'])).toBeNull();
    expect(p('archive', ['x'])).toMatch(/applies to the whole offer/);
    expect(p('cap_change', ['x'], { capType: 'daily_click', capValue: 5 })).toMatch(/applies to the whole offer/);
    expect(p('cap_change')).toMatch(/needs capType/);
    expect(p('cap_change', [], { capType: 'daily_click' })).toMatch(/needs capValue/);
    expect(p('cap_change', [], { capType: 'daily_click', capValue: -1 })).toMatch(/needs capValue/);
    expect(p('cap_change', [], { capType: 'daily_click', capValue: 1.5 })).toMatch(/needs capValue/);
    expect(p('cap_change', [], { capType: 'total_conversion', capValue: null })).toBeNull();
    expect(p('cap_change', [], { capType: 'daily_conversion', capValue: 0 })).toBeNull();
  });

  it('an update keeps the cap fields it does not set', () => {
    expect(scheduledActionParams({ capValue: 9 }, { capType: 'daily_click', capValue: 1 })).toEqual({ capType: 'daily_click', capValue: 9 });
    expect(scheduledActionParams({}, { capType: 'daily_click', capValue: 1 })).toEqual({ capType: 'daily_click', capValue: 1 });
  });
});
