// Saved & Scheduled "Open" links (lib/savedReportLink.ts) — imports the real module.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SAVED_REPORT_SOURCES, savedReportHref } from '../savedReportLink.ts';

const src = (key: string) => {
  const s = SAVED_REPORT_SOURCES.find((x) => x.key === key);
  assert.ok(s, key);
  return s;
};
const parse = (href: string) => {
  const [path, query = ''] = href.split('?');
  return { path, sp: new URLSearchParams(query) };
};

describe('SAVED_REPORT_SOURCES', () => {
  it('includes Flex and Nested with their Analytics tab routes', () => {
    assert.strictEqual(src('flex-report').route, '/app/analytics?tab=flex');
    assert.strictEqual(src('nested-report').route, '/app/analytics?tab=nested');
  });
});

describe('savedReportHref', () => {
  const base = {
    from: '2026-09-01', to: '2026-09-30',
    filters: { offer: ['o1', 'o2'], partner: ['p1'] }, exclusions: { country: ['US'] },
    metricFilters: { clicks: { op: '>=', value: '100' } }, ignoreFailTraffic: true,
    orderBy: 'revenue', orderDir: 'asc', hiddenColumns: ['CTR'],
  };

  it('aggregate page: dates, f.*, x.*, mf.*, ignoreFail, orderBy/orderDir — no hidden columns', () => {
    const { path, sp } = parse(savedReportHref(src('offer-report'), base));
    assert.strictEqual(path, '/app/reports/offer');
    assert.strictEqual(sp.get('from'), '2026-09-01');
    assert.strictEqual(sp.get('to'), '2026-09-30');
    assert.strictEqual(sp.get('f.offer'), 'o1,o2');
    assert.strictEqual(sp.get('f.partner'), 'p1');
    assert.strictEqual(sp.get('x.country'), 'US');
    assert.strictEqual(sp.get('mf.clicks'), '>=:100');
    assert.strictEqual(sp.get('ignoreFail'), '1');
    assert.strictEqual(sp.get('orderBy'), 'revenue');
    assert.strictEqual(sp.get('orderDir'), 'asc');
    assert.ok(![...sp.keys()].some((k) => /hidden/i.test(k)));
    assert.strictEqual(sp.get('dims'), null);
    assert.strictEqual(sp.get('parent'), null);
  });

  it('flex keeps tab=flex and adds dims', () => {
    const { path, sp } = parse(savedReportHref(src('flex-report'), { ...base, dims: ['offer', 'country'] }));
    assert.strictEqual(path, '/app/analytics');
    assert.strictEqual(sp.get('tab'), 'flex');
    assert.strictEqual(sp.get('dims'), 'offer,country');
    assert.strictEqual(sp.get('f.offer'), 'o1,o2');
  });

  it('nested keeps tab=nested and adds parent/child', () => {
    const { path, sp } = parse(savedReportHref(src('nested-report'), { ...base, parentDim: 'publisher', childDim: 'country' }));
    assert.strictEqual(path, '/app/analytics');
    assert.strictEqual(sp.get('tab'), 'nested');
    assert.strictEqual(sp.get('parent'), 'publisher');
    assert.strictEqual(sp.get('child'), 'country');
  });

  it('drops malformed stored data instead of writing junk params', () => {
    const { sp } = parse(savedReportHref(src('daily-report'), {
      from: '', to: 5, filters: { offer: 'not-an-array', partner: [] }, exclusions: null,
      metricFilters: { clicks: { op: '!=', value: '1' }, revenue: { op: '>', value: 'abc' }, payout: 'x' },
      ignoreFailTraffic: 'yes', orderBy: '', orderDir: 'sideways',
    }));
    assert.deepStrictEqual([...sp.keys()], []);
  });

  it('a config with nothing to carry is just the route', () => {
    assert.strictEqual(savedReportHref(src('hourly-report'), {}), '/app/reports/hourly');
    assert.strictEqual(savedReportHref(src('flex-report'), {}), '/app/analytics?tab=flex');
  });
});
