/**
 * SmartSwitch (D8), the pure parts: when a rule can run (smartSwitchProblem) and its Action Delay.
 */
import { describe, it, expect } from 'vitest';
import { parseDelay, smartSwitchProblem } from '../../src/lib/automation/smartswitch.js';

const rule = (o: Partial<Parameters<typeof smartSwitchProblem>[0]> = {}) =>
  smartSwitchProblem({ conditions: 'cr < 1 AND clicks >= 100 in 24h', action: 'block', actionDelay: null, params: {}, ...o });

describe('Action Delay', () => {
  it('reads the form’s "30 minutes" / "2 hours" / "1 days" and short forms, in minutes', () => {
    expect(parseDelay(null)).toBe(0);
    expect(parseDelay('')).toBe(0);
    expect(parseDelay('30 minutes')).toBe(30);
    expect(parseDelay('2 hours')).toBe(120);
    expect(parseDelay('1 days')).toBe(1440);
    expect(parseDelay('45m')).toBe(45);
    expect(parseDelay('15')).toBe(15);
    expect(parseDelay('31 days')).toBeNull();
    expect(parseDelay('soon')).toBeNull();
  });
});

describe('a rule that can run', () => {
  it('needs conditions in the Automation grammar, always per partner on each offer', () => {
    expect(rule()).toBeNull();
    expect(rule({ conditions: '' })).toMatch(/Add conditions/);
    expect(rule({ conditions: 'cr << 1' })).toMatch(/Can't read/);
    expect(rule({ conditions: 'cr < 1 AND clicks >= 100 per partner' })).toMatch(/leave out "per/);
  });
  it('an action other than notify needs a minimum volume (clicks >= n); notify does not', () => {
    expect(rule({ conditions: 'cr < 1 in 24h' })).toMatch(/minimum volume/);
    expect(rule({ conditions: 'cr < 1 AND clicks < 100' })).toMatch(/minimum volume/);
    expect(rule({ conditions: 'cr < 1 in 24h', action: 'notify' })).toBeNull();
  });
  it("redirect needs an http(s) URL; payout a non-negative amount", () => {
    expect(rule({ action: 'redirect' })).toMatch(/http\(s\) URL/);
    expect(rule({ action: 'redirect', params: { redirectUrl: 'javascript:alert(1)' } })).toMatch(/http\(s\) URL/);
    expect(rule({ action: 'redirect', params: { redirectUrl: 'https://lp.example.com/x' } })).toBeNull();
    expect(rule({ action: 'payout' })).toMatch(/new payout/);
    expect(rule({ action: 'payout', params: { payout: '-1' } })).toMatch(/0 or more/);
    expect(rule({ action: 'payout', params: { payout: 'abc' } })).toMatch(/decimal amount/);
    expect(rule({ action: 'payout', params: { payout: '1.5' } })).toBeNull();
    expect(rule({ actionDelay: 'tomorrow' })).toMatch(/Action Delay/);
  });
});
