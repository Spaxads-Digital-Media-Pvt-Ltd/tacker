// Report schedule form ⇄ cron (lib/reportSchedule.ts): what the Schedule dialog shows for a stored
// expression, and what it saves.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { DEFAULT_SCHEDULE, describeSchedule, fromCron, parseRecipients, toCron } from '../reportSchedule.ts';

describe('toCron / fromCron', () => {
  it('daily, weekly and monthly round-trip', () => {
    for (const f of [
      { ...DEFAULT_SCHEDULE, frequency: 'daily' as const, time: '08:05' },
      { ...DEFAULT_SCHEDULE, frequency: 'weekly' as const, time: '17:30', weekday: 5 },
      { ...DEFAULT_SCHEDULE, frequency: 'monthly' as const, time: '00:00', dayOfMonth: 28 },
    ]) {
      const cron = toCron(f);
      assert.deepStrictEqual(fromCron(cron), f);
    }
    assert.strictEqual(toCron({ ...DEFAULT_SCHEDULE, frequency: 'daily', time: '08:05' }), '5 8 * * *');
    assert.strictEqual(toCron({ ...DEFAULT_SCHEDULE, frequency: 'weekly', time: '17:30', weekday: 5 }), '30 17 * * 5');
    assert.strictEqual(toCron({ ...DEFAULT_SCHEDULE, frequency: 'monthly', time: '00:00', dayOfMonth: 28 }), '0 0 28 * *');
  });

  it('anything else stays as typed, as "custom"', () => {
    for (const expr of ['*/15 * * * *', '0 8 * * MON-FRI', '0 8 31 * *', '0 8 1 1 *', '0 8,20 * * *']) {
      assert.deepStrictEqual(fromCron(expr), { ...DEFAULT_SCHEDULE, frequency: 'custom', cron: expr });
    }
    assert.strictEqual(toCron({ ...DEFAULT_SCHEDULE, frequency: 'custom', cron: '  0  8 *  * 1 ' }), '0 8 * * 1');
  });

  it('Sunday as 7 reads as Sunday; no schedule gives the default form', () => {
    assert.strictEqual(fromCron('0 9 * * 7').weekday, 0);
    assert.deepStrictEqual(fromCron(null), DEFAULT_SCHEDULE);
  });
});

describe('describeSchedule / parseRecipients', () => {
  it('describes each kind for the table', () => {
    assert.deepStrictEqual(describeSchedule('0 8 * * *'), { frequency: 'Daily at 08:00', weekday: '—', day: '—' });
    assert.deepStrictEqual(describeSchedule('30 6 * * 1'), { frequency: 'Weekly at 06:30', weekday: 'Monday', day: '—' });
    assert.deepStrictEqual(describeSchedule('0 7 15 * *'), { frequency: 'Monthly at 07:00', weekday: '—', day: '15' });
    assert.deepStrictEqual(describeSchedule('*/30 * * * *'), { frequency: 'Custom (*/30 * * * *)', weekday: '—', day: '—' });
    assert.deepStrictEqual(describeSchedule(null), { frequency: '—', weekday: '—', day: '—' });
  });

  it('recipients: any separator, lower-cased, no duplicates', () => {
    assert.deepStrictEqual(parseRecipients('Ops@Example.com, cfo@example.com\nops@example.com;  team@x.io '), ['ops@example.com', 'cfo@example.com', 'team@x.io']);
    assert.deepStrictEqual(parseRecipients('   '), []);
  });
});
