/** Feature flag evaluation (lib/platform/flags.ts) — pure. */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { evaluateFlag, rolloutBucket } from '../../src/lib/platform/flags.js';

const base = { key: 'smartswitch', enabled: false, rollout_percent: 0, plan_ids: [] as string[], network_ids_on: [] as string[], network_ids_off: [] as string[], kill_switch: false };

describe('feature flags', () => {
  it('order: kill switch › listed off › listed on › plan › enabled › rollout', () => {
    const n = randomUUID(); const p = randomUUID();
    expect(evaluateFlag(base, n, null)).toBe(false);
    expect(evaluateFlag({ ...base, enabled: true }, n, null)).toBe(true);
    expect(evaluateFlag({ ...base, plan_ids: [p] }, n, p)).toBe(true);
    expect(evaluateFlag({ ...base, network_ids_on: [n] }, n, null)).toBe(true);
    expect(evaluateFlag({ ...base, enabled: true, network_ids_off: [n] }, n, null)).toBe(false);
    expect(evaluateFlag({ ...base, network_ids_on: [n], kill_switch: true }, n, null)).toBe(false);
    expect(evaluateFlag({ ...base, rollout_percent: 100 }, n, null)).toBe(true);
  });

  it('rollout is stable per network and grows monotonically', () => {
    const nets = Array.from({ length: 2000 }, () => randomUUID());
    const on = (pct: number) => new Set(nets.filter((n) => evaluateFlag({ ...base, rollout_percent: pct }, n, null)));
    const at10 = on(10); const at50 = on(50);
    for (const n of at10) expect(at50.has(n)).toBe(true); // nobody falls out as it grows
    expect(at10.size).toBeGreaterThan(120); expect(at10.size).toBeLessThan(280);
    expect(at50.size).toBeGreaterThan(880); expect(at50.size).toBeLessThan(1120);
    expect(rolloutBucket('smartswitch', nets[0]!)).toBe(rolloutBucket('smartswitch', nets[0]!));
  });
});
