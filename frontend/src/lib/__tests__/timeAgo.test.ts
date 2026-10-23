// timeAgo (lib/datetime.ts) — the compact "5m ago" age used by the notifications popover.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { timeAgo } from '../datetime.ts';

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe('timeAgo', () => {
  it('under a minute → "Just now" (including a clock-skewed future time)', () => {
    assert.strictEqual(timeAgo(ago(30_000), NOW), 'Just now');
    assert.strictEqual(timeAgo(ago(-5 * MIN), NOW), 'Just now');
  });

  it('minutes, hours, days', () => {
    assert.strictEqual(timeAgo(ago(MIN), NOW), '1m ago');
    assert.strictEqual(timeAgo(ago(59 * MIN), NOW), '59m ago');
    assert.strictEqual(timeAgo(ago(60 * MIN), NOW), '1h ago');
    assert.strictEqual(timeAgo(ago(23 * 60 * MIN + 59 * MIN), NOW), '23h ago');
    assert.strictEqual(timeAgo(ago(24 * 60 * MIN), NOW), '1d ago');
    assert.strictEqual(timeAgo(ago(6 * 24 * 60 * MIN), NOW), '6d ago');
  });

  it('a week or older → the local date', () => {
    const iso = ago(7 * 24 * 60 * MIN);
    assert.strictEqual(timeAgo(iso, NOW), new Date(iso).toLocaleDateString());
  });

  it('invalid input is returned unchanged', () => {
    assert.strictEqual(timeAgo('not a date', NOW), 'not a date');
  });
});
