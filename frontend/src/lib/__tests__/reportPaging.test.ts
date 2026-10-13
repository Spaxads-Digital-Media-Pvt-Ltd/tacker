// Performance Graph / export paging (lib/reportPaging.ts) — the real loop, against a fake
// `/api/reports` that behaves like the API: chronological day rows, `limit` ≤ 200, `total` returned.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { pageThrough, graphCappedNote, GRAPH_DAY_CAP, REPORT_PAGE_SIZE } from '../reportPaging.ts';

/** `n` active days, oldest first (the API's default order for a day series). */
function fakeReports(n: number, opts: { withTotal?: boolean; failAtOffset?: number } = {}) {
  const days = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2024, 0, 1) + i * 86400e3).toISOString().slice(0, 10));
  const calls: { limit: number; offset: number }[] = [];
  const get = async (limit: number, offset: number) => {
    if (limit > REPORT_PAGE_SIZE) throw new Error('422: limit > 200');
    calls.push({ limit, offset });
    if (offset === opts.failAtOffset) throw new Error('Internal Server Error');
    const rows = days.slice(offset, offset + limit).map((day) => ({ dimensions: { day } }));
    return opts.withTotal === false ? { rows } : { rows, total: n };
  };
  return { days, calls, get };
}
const daysOf = (rows: { dimensions: { day: string } }[]) => rows.map((r) => r.dimensions.day);

describe('pageThrough — Performance Graph ranges', () => {
  it('fewer than 200 active days: one request, every day, not capped', async () => {
    const f = fakeReports(150);
    const r = await pageThrough(f.get, REPORT_PAGE_SIZE, GRAPH_DAY_CAP);
    assert.deepStrictEqual(daysOf(r.rows), f.days);
    assert.strictEqual(r.capped, false);
    assert.strictEqual(r.total, 150);
    assert.deepStrictEqual(f.calls, [{ limit: 200, offset: 0 }]);
  });
  it('exactly 200 active days: one request (total says there is no more), not capped', async () => {
    const f = fakeReports(200);
    const r = await pageThrough(f.get, REPORT_PAGE_SIZE, GRAPH_DAY_CAP);
    assert.strictEqual(r.rows.length, 200);
    assert.strictEqual(r.capped, false);
    assert.deepStrictEqual(f.calls, [{ limit: 200, offset: 0 }]);
  });
  it('201 / 250 active days: pages on, keeps the NEWEST days (the old single request dropped them)', async () => {
    for (const n of [201, 250]) {
      const f = fakeReports(n);
      const r = await pageThrough(f.get, REPORT_PAGE_SIZE, GRAPH_DAY_CAP);
      assert.deepStrictEqual(daysOf(r.rows), f.days, `n=${n}`);
      assert.strictEqual(r.rows.at(-1)!.dimensions.day, f.days.at(-1));
      assert.strictEqual(r.capped, false);
      assert.deepStrictEqual(f.calls, [{ limit: 200, offset: 0 }, { limit: 200, offset: 200 }]);
    }
  });
  it('exactly the cap (1000): five requests, not capped', async () => {
    const f = fakeReports(GRAPH_DAY_CAP);
    const r = await pageThrough(f.get, REPORT_PAGE_SIZE, GRAPH_DAY_CAP);
    assert.strictEqual(r.rows.length, 1000);
    assert.strictEqual(r.capped, false);
    assert.strictEqual(f.calls.length, 5);
  });
  it('more than the cap: stops at 1000 (no request past it), capped, oldest-first and no repeats', async () => {
    const f = fakeReports(1200);
    const r = await pageThrough(f.get, REPORT_PAGE_SIZE, GRAPH_DAY_CAP);
    assert.strictEqual(r.rows.length, 1000);
    assert.strictEqual(r.capped, true);
    assert.strictEqual(r.total, 1200);
    assert.deepStrictEqual(daysOf(r.rows), f.days.slice(0, 1000));
    assert.strictEqual(new Set(daysOf(r.rows)).size, 1000);
    assert.ok(f.calls.every((c) => c.limit <= 200 && c.offset < 1000));
  });
  it('a cap that is not a multiple of the page size asks only for the remainder', async () => {
    const f = fakeReports(500);
    const r = await pageThrough(f.get, REPORT_PAGE_SIZE, 450);
    assert.deepStrictEqual(f.calls.map((c) => c.limit), [200, 200, 50]);
    assert.strictEqual(r.rows.length, 450);
    assert.strictEqual(r.capped, true);
  });
  it('no data: one request, empty, not capped', async () => {
    const f = fakeReports(0);
    const r = await pageThrough(f.get, REPORT_PAGE_SIZE, GRAPH_DAY_CAP);
    assert.deepStrictEqual(r, { rows: [], capped: false, total: 0 });
  });
  it('a failed page rejects (the graph shows the error) — never a silently partial series', async () => {
    const f = fakeReports(450, { failAtOffset: 200 });
    await assert.rejects(pageThrough(f.get, REPORT_PAGE_SIZE, GRAPH_DAY_CAP), /Internal Server Error/);
  });
  it('a source without `total` that fills the cap exactly is reported as capped', async () => {
    const f = fakeReports(400, { withTotal: false });
    const r = await pageThrough(f.get, REPORT_PAGE_SIZE, 400);
    assert.strictEqual(r.capped, true);
    assert.strictEqual(r.total, null);
  });
  it('plain-array pages (detail endpoints) end on a short page', async () => {
    const pages = [Array(200).fill(1), Array(30).fill(2)];
    const r = await pageThrough(async (_l, offset) => pages[offset / 200] ?? [], 200, 10_000);
    assert.strictEqual(r.rows.length, 230);
    assert.strictEqual(r.capped, false);
  });
});

describe('graphCappedNote', () => {
  it('names how much is shown and what to do', () => {
    assert.strictEqual(graphCappedNote(1000, 'days'), 'Graph shows the first 1,000 days — narrow the date range to see the rest.');
    assert.strictEqual(graphCappedNote(2232, 'hours'), 'Graph shows the first 2,232 hours — narrow the date range to see the rest.');
  });
});
