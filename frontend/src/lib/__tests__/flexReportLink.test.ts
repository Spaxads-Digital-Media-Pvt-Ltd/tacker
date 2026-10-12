// Row ⋮ "Open Flex Report" links (lib/flexReportLink.ts) — imports the real module, and checks the
// link against the same URL readers Flex uses on load (lib/reportFilterState.ts).
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { flexReportPath } from '../flexReportLink.ts';
import { readUrlDate, readUrlFilters, readUrlFlag, IGNORE_FAIL_PARAM } from '../reportFilterState.ts';

const parse = (href: string) => {
  const [path, q] = href.split('?');
  return { path, sp: new URLSearchParams(q) };
};
const none = { filters: {}, exclusions: {}, ignoreFailTraffic: false };

describe('flexReportPath', () => {
  it('opens the Flex tab with the applied range', () => {
    const { path, sp } = parse(flexReportPath({ from: '2026-09-01', to: '2026-09-30', reporting: none }));
    assert.strictEqual(path, '/app/analytics');
    assert.strictEqual(sp.get('tab'), 'flex');
    assert.strictEqual(readUrlDate(sp, 'from', 'x'), '2026-09-01');
    assert.strictEqual(readUrlDate(sp, 'to', 'x'), '2026-09-30');
  });

  it("narrows the row's category to the row id and keeps the other filters, exclusions and Ignore Fail", () => {
    const { sp } = parse(flexReportPath({
      from: '2026-09-01', to: '2026-09-30',
      reporting: { filters: { offer: ['o1', 'o2'], country: ['US'] }, exclusions: { device: ['mobile'] }, ignoreFailTraffic: true },
      entity: ['offer', 'o2'],
    }));
    assert.deepStrictEqual(readUrlFilters(sp, 'f'), { offer: ['o2'], country: ['US'] });
    assert.deepStrictEqual(readUrlFilters(sp, 'x'), { device: ['mobile'] });
    assert.strictEqual(readUrlFlag(sp, IGNORE_FAIL_PARAM), true);
  });

  it('a single-day link (Daily/Hourly row) has from = to and no entity filter', () => {
    const { sp } = parse(flexReportPath({ from: '2026-09-15', to: '2026-09-15', reporting: { ...none, filters: { partner: ['p1'] } } }));
    assert.strictEqual(sp.get('from'), '2026-09-15');
    assert.strictEqual(sp.get('to'), '2026-09-15');
    assert.deepStrictEqual(readUrlFilters(sp, 'f'), { partner: ['p1'] });
    assert.strictEqual(sp.get(IGNORE_FAIL_PARAM), null);
  });
});
