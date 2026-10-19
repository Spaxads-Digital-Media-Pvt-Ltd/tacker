/** Customer health score parts and weights (lib/platform/health.ts) — pure. */
import { describe, it, expect } from 'vitest';
import { scoreParts, scoreOf, statusOf, type Signals } from '../../src/lib/platform/health.js';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const base: Signals = {
  clicks7d: 0, clicksPrev7d: 0, clicksToday: 0, clicks30d: 0, conversions7d: 0, lastLoginAt: null, activeUsers14d: 0,
  subscriptionStatus: null, cancelAtPeriodEnd: false, overdueInvoices: 0, suspendedForBilling: false, offers: 0, partners: 0,
};

describe('customer health score', () => {
  it('a busy, paying, set-up network is healthy (100)', () => {
    const parts = scoreParts({ ...base, clicks7d: 1000, clicksPrev7d: 900, clicks30d: 4000, conversions7d: 30, lastLoginAt: daysAgo(1), subscriptionStatus: 'active' }, 100, NOW);
    expect(parts).toEqual({ usage: 100, trend: 100, engagement: 100, billing: 100, onboarding: 100 });
    expect(scoreOf(parts)).toBe(100);
    expect(statusOf(100)).toBe('healthy');
  });

  it('nothing at all is at risk — only "no plan yet" (60 × 20 %) counts', () => {
    const parts = scoreParts(base, 0, NOW);
    expect(parts).toEqual({ usage: 0, trend: 0, engagement: 0, billing: 60, onboarding: 0 });
    expect(scoreOf(parts)).toBe(12);
    expect(statusOf(12)).toBe('at_risk');
  });

  it('usage: clicks without conversions 60; only older traffic 25; today’s first clicks count', () => {
    expect(scoreParts({ ...base, clicks7d: 5, clicks30d: 5 }, 0, NOW).usage).toBe(60);
    expect(scoreParts({ ...base, clicksToday: 3, clicks30d: 3, conversions7d: 1 }, 0, NOW)).toMatchObject({ usage: 100, trend: 100 });
    expect(scoreParts({ ...base, clicks30d: 5 }, 0, NOW).usage).toBe(25);
  });

  it('trend: this week against last — steps at 100 %, 80 %, 50 %', () => {
    const t = (cur: number, prev: number) => scoreParts({ ...base, clicks7d: cur, clicksPrev7d: prev }, 0, NOW).trend;
    expect([t(100, 100), t(80, 100), t(79, 100), t(50, 100), t(49, 100), t(5, 0), t(0, 0)]).toEqual([100, 75, 45, 45, 15, 100, 0]);
  });

  it('engagement: days since the last sign-in', () => {
    const e = (d: number | null) => scoreParts({ ...base, lastLoginAt: d === null ? null : daysAgo(d) }, 0, NOW).engagement;
    expect([e(0.5), e(3), e(6), e(10), e(20), e(40), e(null)]).toEqual([100, 100, 80, 55, 25, 0, 0]);
  });

  it('billing: suspended for billing 0 · overdue / past due 30 · canceling 40 · trial 80 · active 100', () => {
    const b = (s: Partial<Signals>) => scoreParts({ ...base, ...s }, 0, NOW).billing;
    expect(b({ subscriptionStatus: 'active', suspendedForBilling: true })).toBe(0);
    expect(b({ subscriptionStatus: 'active', overdueInvoices: 1 })).toBe(30);
    expect(b({ subscriptionStatus: 'past_due' })).toBe(30);
    expect(b({ subscriptionStatus: 'canceled' })).toBe(20);
    expect(b({ subscriptionStatus: 'active', cancelAtPeriodEnd: true })).toBe(40);
    expect(b({ subscriptionStatus: 'trialing' })).toBe(80);
  });

  it('weights: usage 30 · trend 15 · engagement 20 · billing 20 · onboarding 15; bands 70 / 40', () => {
    expect(scoreOf({ usage: 100, trend: 0, engagement: 0, billing: 0, onboarding: 0 })).toBe(30);
    expect(scoreOf({ usage: 0, trend: 0, engagement: 0, billing: 0, onboarding: 50 })).toBe(8); // 7.5 rounds up
    expect([statusOf(70), statusOf(69), statusOf(40), statusOf(39)]).toEqual(['healthy', 'attention', 'attention', 'at_risk']);
  });
});
