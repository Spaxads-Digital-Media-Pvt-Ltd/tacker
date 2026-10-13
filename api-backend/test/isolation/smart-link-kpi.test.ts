/**
 * Smart-Link KPI weights and the Partner Tier payout (audit F-17b) — no DB.
 *  - kpiWeights: once an item has the minimum clicks and a score above zero, the best item(s) share
 *    80 points and every other item shares 20 (≥ 1 each); before that, nothing is computed.
 *  - tierPayout: revenue × (1 − margin/100), exact decimals, never below zero.
 */
import { describe, it, expect } from 'vitest';
import { kpiWeights, type KpiItemStats } from '../../src/lib/smart-links/kpi.js';
import { tierPayout } from '../../src/lib/partner-tiers.js';

const item = (id: string, clicks: number, conversions = 0, payout = '0', revenue = '0'): KpiItemStats => ({ id, clicks, conversions, payout, revenue });
const weights = (r: ReturnType<typeof kpiWeights>) => Object.fromEntries([...r].map(([id, w]) => [id, w.weight]));

describe('kpiWeights', () => {
  it('learning: no item has enough clicks, or nothing converts yet → no weights (even rotation)', () => {
    expect(weights(kpiWeights([item('a', 49, 10), item('b', 10, 5)], 'CVR', 50))).toEqual({ a: null, b: null });
    expect(weights(kpiWeights([item('a', 500), item('b', 500)], 'CVR', 50))).toEqual({ a: null, b: null });
  });

  it('CVR: the best qualified item gets 80; the rest — qualified or still learning — share 20', () => {
    const r = kpiWeights([item('a', 100, 5), item('b', 100, 2), item('c', 10, 9)], 'CVR', 50);
    expect(weights(r)).toEqual({ a: 80, b: 10, c: 10 });
    expect(r.get('a')).toMatchObject({ score: 0.05, clicks: 100 });
    expect(r.get('c')).toMatchObject({ score: null, clicks: 10 }); // not enough clicks to be scored
  });

  it('ties share the winner share; a lone qualified winner with no others gets everything', () => {
    expect(weights(kpiWeights([item('a', 100, 5), item('b', 200, 10), item('c', 100, 1)], 'CVR', 50))).toEqual({ a: 40, b: 40, c: 20 });
    expect(weights(kpiWeights([item('a', 100, 5)], 'CVR', 50))).toEqual({ a: 100 });
    expect(weights(kpiWeights([item('a', 100, 5), item('b', 100, 5)], 'CVR', 50))).toEqual({ a: 50, b: 50 });
  });

  it('EPC ranks by payout per click; Revenue by revenue per click (not by total traffic)', () => {
    const stats = [item('a', 1000, 10, '50.0000', '60.0000'), item('b', 100, 1, '20.0000', '10.0000')];
    expect(weights(kpiWeights(stats, 'EPC', 50))).toEqual({ a: 20, b: 80 }); // 0.05 vs 0.20 per click
    expect(weights(kpiWeights(stats, 'Revenue', 50))).toEqual({ a: 20, b: 80 }); // 0.06 vs 0.10 per click
  });

  it('every other item keeps at least one point however many there are', () => {
    const many = [item('w', 100, 9), ...Array.from({ length: 30 }, (_, i) => item(`x${i}`, 100, 1))];
    const w = weights(kpiWeights(many, 'CVR', 50));
    expect(w['w']).toBe(80);
    expect(Object.entries(w).filter(([k]) => k !== 'w').every(([, v]) => v === 1)).toBe(true);
  });
});

describe('tierPayout', () => {
  it('pays revenue × (1 − margin) exactly, never below zero; nothing without revenue or margin', () => {
    expect(tierPayout('8.0000', '20.00')).toBe('6.4000');
    expect(tierPayout('9999999999.9999', '12.50')).toBe('8749999999.9999');
    expect(tierPayout('10.0000', '0')).toBe('10.0000');
    expect(tierPayout('10.0000', '100')).toBe('0.0000');
    expect(tierPayout(null, '20')).toBeNull();
    expect(tierPayout('8.0000', undefined)).toBeNull();
    expect(tierPayout('not money', '20')).toBeNull();
  });
});
