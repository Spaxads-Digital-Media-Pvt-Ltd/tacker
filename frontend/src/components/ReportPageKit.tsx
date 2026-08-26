/**
 * Shared building blocks for the "Reporting › X" dedicated report pages (Offer, Partner, …) — all
 * verified item-by-item against the live Everflow reference, which uses the identical Summary tile
 * set, "Reporting Filters" flyout structure, and page-level kebab across every report type. Kept
 * here once instead of duplicated per report page.
 *
 * Metric/column scope: Gross Clicks / Clicks (net of fraud-flagged) / Dup. Clicks / Invalid Clicks /
 * Total CV (all statuses) / CV (approved only) / Fraud (avg 0-100 fraud score) all derive from real
 * columns (`clicks.is_unique`, `clicks.fraud_flags`, `clicks.fraud_score`, `conversions.status` —
 * see api-backend/src/lib/reporting/postgres.ts). Impressions/CTR/CPM/RPM/VT CV/Media Buying
 * Cost/Avg Sale Value/Gross Sales/Throttle/Events have no real source anywhere in this app — shown
 * as "—" rather than a fabricated 0, so the tile/column is structurally present but honestly marked
 * untracked.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, MoreVertical, Search } from 'lucide-react';
import type { FilterCategory, FilterValues } from './CategorizedFilters';

export interface AggRow { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }
export interface AggResult { rows: AggRow[]; total?: number }

export const METRICS_PARAM = 'clicks,unique_clicks,invalid_clicks,conversions,total_conversions,payout,revenue,margin,avg_fraud_score,epc';
export const DASH = '—';
export const DEVICES = ['desktop', 'mobile', 'tablet'] as const;

export const money = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
export const num = (v: string | number) => Number(v);

export function toIso(dateStr: string, endOfDay = false): string {
  return endOfDay ? `${dateStr}T23:59:59.999Z` : `${dateStr}T00:00:00.000Z`;
}
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function deriveRow(m: Record<string, string | number>) {
  const clicksGross = num(m['clicks'] ?? 0);
  const uniqueClicks = num(m['unique_clicks'] ?? 0);
  const invalidClicks = num(m['invalid_clicks'] ?? 0);
  const clicks = Math.max(0, clicksGross - invalidClicks); // net/valid clicks
  const dupClicks = Math.max(0, clicksGross - uniqueClicks);
  const totalCv = num(m['total_conversions'] ?? 0);
  const cv = num(m['conversions'] ?? 0); // approved only
  const payout = num(m['payout'] ?? 0);
  const revenue = num(m['revenue'] ?? 0);
  const margin = num(m['margin'] ?? 0);
  const fraudScore = num(m['avg_fraud_score'] ?? 0); // 0-100, avg of clicks.fraud_score for the group
  const epc = num(m['epc'] ?? 0); // real backend metric: payout / clicks
  return {
    clicksGross, clicks, uniqueClicks, dupClicks, invalidClicks, totalCv, cv, payout, revenue, margin, fraudScore, epc,
    cvr: clicks > 0 ? totalCv / clicks : 0,
    cpc: clicks > 0 ? payout / clicks : 0,
    cpa: cv > 0 ? payout / cv : 0,
    rpc: clicks > 0 ? revenue / clicks : 0,
    rpa: totalCv > 0 ? revenue / totalCv : 0,
    invalidPct: clicksGross > 0 ? invalidClicks / clicksGross : 0,
    marginPct: revenue > 0 ? margin / revenue : 0,
  };
}
export type DerivedRow = ReturnType<typeof deriveRow>;

export function MiniChart({ labels, revenue, clicks }: { labels: string[]; revenue: number[]; clicks: number[] }) {
  const w = 900, h = 220, padL = 40, padR = 40, padT = 12, padB = 24;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const n = Math.max(1, labels.length);
  const revMax = Math.max(1, ...revenue), clickMax = Math.max(1, ...clicks);
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yRev = (v: number) => padT + plotH - (v / revMax) * plotH;
  const yClick = (v: number) => padT + plotH - (v / clickMax) * plotH;
  const revArea = revenue.length
    ? `${revenue.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yRev(v).toFixed(1)}`).join(' ')} L${x(n - 1).toFixed(1)},${padT + plotH} L${x(0).toFixed(1)},${padT + plotH} Z`
    : '';
  const clickLine = clicks.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yClick(v).toFixed(1)}`).join(' ');
  const step = Math.max(1, Math.ceil(n / 10));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 240 }}>
      <path d={revArea} fill="var(--color-accent-text, #6366f1)" opacity={0.15} />
      <path d={revenue.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yRev(v).toFixed(1)}`).join(' ')} fill="none" stroke="var(--color-accent-text, #6366f1)" strokeWidth={2} />
      <path d={clickLine} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" />
      {labels.map((l, i) => (i % step === 0 ? (
        <text key={i} x={x(i)} y={h - 4} fontSize={9} textAnchor="middle" fill="var(--color-fg-secondary, #64748b)">{l.slice(5)}</text>
      ) : null))}
    </svg>
  );
}

export function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-tiny uppercase text-fg-secondary">{label}</p>
      <p className={`text-h3 font-semibold ${value === DASH ? 'text-fg-muted' : 'text-fg'}`}>{value}</p>
    </div>
  );
}

/** The fixed 21-tile Summary grid, identical across every report type on the live reference. */
export function SummaryGrid({ summary }: { summary: DerivedRow }) {
  return (
    <div className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-4 lg:grid-cols-7">
      <SummaryTile label="Media Buying Cost" value={DASH} />
      <SummaryTile label="Impression" value={DASH} />
      <SummaryTile label="Gross Clicks" value={summary.clicksGross.toLocaleString()} />
      <SummaryTile label="Clicks" value={summary.clicks.toLocaleString()} />
      <SummaryTile label="Total CV" value={summary.totalCv.toLocaleString()} />
      <SummaryTile label="VT CV" value={DASH} />
      <SummaryTile label="CTR" value={DASH} />
      <SummaryTile label="Event" value={DASH} />
      <SummaryTile label="CVR" value={pct(summary.cvr)} />
      <SummaryTile label="CPC" value={money(summary.cpc)} />
      <SummaryTile label="CPA" value={money(summary.cpa)} />
      <SummaryTile label="RPC" value={money(summary.rpc)} />
      <SummaryTile label="CPM" value={DASH} />
      <SummaryTile label="RPM" value={DASH} />
      <SummaryTile label="RPA" value={money(summary.rpa)} />
      <SummaryTile label="Payout" value={money(summary.payout)} />
      <SummaryTile label="Revenue" value={money(summary.revenue)} />
      <SummaryTile label="Profit" value={money(summary.margin)} />
      <SummaryTile label="Margin" value={pct(summary.marginPct)} />
      <SummaryTile label="Avg. Sale Value" value={DASH} />
      <SummaryTile label="Gross Sales" value={DASH} />
    </div>
  );
}

export type MetricFilterKey =
  | 'clicks' | 'uniqueClicks' | 'dupClicks' | 'invalidClicks' | 'totalCv' | 'cv' | 'payout' | 'revenue' | 'fraudScore';
export type MetricOp = '>' | '>=' | '<' | '<=';
export interface MetricFilterEntry { op: MetricOp; value: string }
export type MetricFilters = Partial<Record<MetricFilterKey, MetricFilterEntry>>;
export const METRIC_FILTER_FIELDS: { key: MetricFilterKey; label: string }[] = [
  { key: 'clicks', label: 'Clicks' },
  { key: 'uniqueClicks', label: 'Unique Clicks' },
  { key: 'dupClicks', label: 'Dup. Click' },
  { key: 'invalidClicks', label: 'Invalid Clicks' },
  { key: 'totalCv', label: 'Total CV' },
  { key: 'cv', label: 'CV' },
  { key: 'payout', label: 'Payout' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'fraudScore', label: 'Fraud' },
];
const OP_LABEL: Record<MetricOp, string> = { '>': '>', '>=': '≥', '<': '<', '<=': '≤' };
const OP_TEST: Record<MetricOp, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b,
};
export function passesMetricFilters(d: DerivedRow, metricFilters: MetricFilters): boolean {
  for (const f of METRIC_FILTER_FIELDS) {
    const entry = metricFilters[f.key];
    if (!entry || entry.value === '') continue;
    const threshold = Number(entry.value);
    if (Number.isNaN(threshold)) continue;
    if (!OP_TEST[entry.op](d[f.key], threshold)) return false;
  }
  return true;
}

export interface ReportingFiltersValue { filters: FilterValues; exclusions: FilterValues; metricFilters: MetricFilters; ignoreFailTraffic: boolean }
export function dimCount(v: FilterValues): number { return Object.values(v).reduce((n, a) => n + (a?.length ?? 0), 0); }
export function reportingFiltersCount(v: ReportingFiltersValue): number {
  return dimCount(v.filters) + dimCount(v.exclusions) + Object.values(v.metricFilters).filter((m) => m?.value).length + (v.ignoreFailTraffic ? 1 : 0);
}

/**
 * "Reporting Filters" — verified against the live reference: a root menu of Filters / Metric
 * Filters / Exclusions / Others, each drilling into its own submenu. Filters/Exclusions share the
 * same dimension categories (Offer/Advertiser/Partner/Country/Device — all real, backend-filterable
 * dimensions; the reference's Offer Group/Coupon Code/Smart Link/Partner Tier/Tracking
 * Domain/Offer URL/Partner Manager/Account Manager/Sales Manager have no equivalent in this app's
 * report API and are omitted). Metric Filters covers the real per-row metrics this report already
 * computes (Clicks/Unique/Dup./Invalid Clicks, Total CV/CV, Payout, Revenue, Fraud) applied
 * client-side against the currently-loaded table rows — the backend has no HAVING-style aggregate
 * filter. Others › "Ignore Fail Traffic" is real: it excludes fraud-flagged clicks from the
 * aggregation entirely (api-backend/src/lib/reporting/postgres.ts `excludeInvalid`).
 */
export function ReportingFiltersFlyout({
  dimCategories, value, onApply, onClose,
}: { dimCategories: FilterCategory[]; value: ReportingFiltersValue; onApply: (v: ReportingFiltersValue) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<string[]>([]);
  const [draftFilters, setDraftFilters] = useState<FilterValues>(value.filters);
  const [draftExclusions, setDraftExclusions] = useState<FilterValues>(value.exclusions);
  const [draftMetric, setDraftMetric] = useState<MetricFilters>(value.metricFilters);
  const [draftIgnoreFail, setDraftIgnoreFail] = useState(value.ignoreFailTraffic);
  const [catSearch, setCatSearch] = useState('');
  const [leafSearch, setLeafSearch] = useState('');

  useEffect(() => { setCatSearch(''); setLeafSearch(''); }, [path]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const push = (seg: string) => setPath((p) => [...p, seg]);
  const pop = () => setPath((p) => p.slice(0, -1));
  const metricCount = Object.values(draftMetric).filter((m) => m?.value).length;
  const total = dimCount(draftFilters) + dimCount(draftExclusions) + metricCount + (draftIgnoreFail ? 1 : 0);
  const clearAll = () => { setDraftFilters({}); setDraftExclusions({}); setDraftMetric({}); setDraftIgnoreFail(false); };
  const apply = () => { onApply({ filters: draftFilters, exclusions: draftExclusions, metricFilters: draftMetric, ignoreFailTraffic: draftIgnoreFail }); onClose(); };

  const Footer = () => (
    <div className="flex justify-end gap-2 border-t border-border px-3 py-2.5">
      <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
      <button type="button" className="btn-primary" onClick={apply}>Apply{total > 0 ? ` (${total})` : ''}</button>
    </div>
  );

  let body: JSX.Element;

  if (path.length === 0) {
    body = (
      <div className="w-72">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <h3 className="text-small font-semibold text-fg">Reporting Filters</h3>
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
        </div>
        <div className="py-1">
          {([
            ['filters', 'Filters', dimCount(draftFilters)],
            ['metric', 'Metric Filters', metricCount],
            ['exclusions', 'Exclusions', dimCount(draftExclusions)],
            ['others', 'Others', draftIgnoreFail ? 1 : 0],
          ] as const).map(([seg, label, n]) => (
            <button key={seg} type="button" onClick={() => push(seg)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
              <span className="flex items-center gap-2">{label}{n > 0 && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{n}</span>}</span>
              <ChevronRight size={13} className="text-fg-muted" />
            </button>
          ))}
        </div>
        <Footer />
      </div>
    );
  } else if (path[0] === 'filters' || path[0] === 'exclusions') {
    const isExclude = path[0] === 'exclusions';
    const draft = isExclude ? draftExclusions : draftFilters;
    const setDraft = isExclude ? setDraftExclusions : setDraftFilters;

    if (path.length === 1) {
      const visible = dimCategories.filter((c) => c.label.toLowerCase().includes(catSearch.toLowerCase()));
      body = (
        <div className="w-72">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <button type="button" onClick={pop} className="flex items-center gap-1 text-small font-semibold text-fg hover:text-accent-text">
              <ChevronLeft size={15} /> {isExclude ? 'Exclusions' : 'Filters'}
            </button>
            <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setDraft({})}>Clear</button>
          </div>
          <div className="relative border-b border-border px-3 py-2">
            <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !pl-7" placeholder="Search…" value={catSearch} onChange={(e) => setCatSearch(e.target.value)} autoFocus />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {visible.map((c) => {
              const n = (draft[c.key] ?? []).length;
              return (
                <button key={c.key} type="button" onClick={() => push(c.key)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                  <span className="flex items-center gap-2">{c.label}{n > 0 && <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{n}</span>}</span>
                  <ChevronRight size={13} className="text-fg-muted" />
                </button>
              );
            })}
          </div>
          <Footer />
        </div>
      );
    } else {
      const cat = dimCategories.find((c) => c.key === path[1])!;
      const selected = draft[cat.key] ?? [];
      const filteredOptions = cat.options.filter((o) => o.label.toLowerCase().includes(leafSearch.toLowerCase()));
      const toggle = (v: string) => setDraft((d) => ({ ...d, [cat.key]: selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v] }));
      body = (
        <div className="w-80">
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <button type="button" onClick={pop} className="flex items-center gap-1 text-small font-semibold text-fg hover:text-accent-text">
              <ChevronLeft size={15} /> {cat.label}
            </button>
            <div className="flex items-center gap-2 text-tiny">
              <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => setDraft((d) => ({ ...d, [cat.key]: cat.options.map((o) => o.value) }))}>Select All</button>
              <span className="text-border">|</span>
              <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => setDraft((d) => ({ ...d, [cat.key]: [] }))}>Clear</button>
            </div>
          </div>
          <div className="relative border-b border-border px-3 py-2">
            <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !pl-7" placeholder="Search…" value={leafSearch} onChange={(e) => setLeafSearch(e.target.value)} autoFocus />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredOptions.length === 0 && <p className="px-3 py-3 text-small text-fg-muted">No options.</p>}
            {filteredOptions.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small text-fg hover:bg-accent-subtle">
                <input type="checkbox" className="chk" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
          <Footer />
        </div>
      );
    }
  } else if (path[0] === 'metric') {
    body = (
      <div className="w-96">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <button type="button" onClick={pop} className="flex items-center gap-1 text-small font-semibold text-fg hover:text-accent-text">
            <ChevronLeft size={15} /> Metric Filters
          </button>
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setDraftMetric({})}>Clear</button>
        </div>
        <div className="max-h-80 space-y-2.5 overflow-y-auto p-3">
          {METRIC_FILTER_FIELDS.map((f) => {
            const entry = draftMetric[f.key];
            return (
              <div key={f.key} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-small text-fg">{f.label}</span>
                <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
                  {(['>', '>=', '<', '<='] as MetricOp[]).map((op) => (
                    <button key={op} type="button"
                      onClick={() => setDraftMetric((m) => ({ ...m, [f.key]: { op, value: m[f.key]?.value ?? '' } }))}
                      className={`px-2 py-1 text-tiny ${entry?.op === op ? 'bg-accent text-white' : 'bg-surface text-fg-secondary hover:bg-accent-subtle'}`}>
                      {OP_LABEL[op]}
                    </button>
                  ))}
                </div>
                <input type="number" className="input !w-24" placeholder="Value" value={entry?.value ?? ''}
                  onChange={(e) => setDraftMetric((m) => ({ ...m, [f.key]: { op: m[f.key]?.op ?? '>', value: e.target.value } }))} />
              </div>
            );
          })}
        </div>
        <Footer />
      </div>
    );
  } else {
    body = (
      <div className="w-72">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <button type="button" onClick={pop} className="flex items-center gap-1 text-small font-semibold text-fg hover:text-accent-text">
            <ChevronLeft size={15} /> Others
          </button>
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setDraftIgnoreFail(false)}>Clear</button>
        </div>
        <label className="flex cursor-pointer items-center gap-2 px-3 py-3 text-small text-fg hover:bg-accent-subtle">
          <input type="checkbox" className="chk" checked={draftIgnoreFail} onChange={(e) => setDraftIgnoreFail(e.target.checked)} />
          Ignore Fail Traffic
        </label>
        <Footer />
      </div>
    );
  }

  return (
    <div ref={ref} className="absolute right-0 top-full z-30 mt-1 rounded-card border border-border bg-elevated shadow-elevated">
      {body}
    </div>
  );
}

/**
 * Per-row kebab used in every report table. Rendered via a portal with fixed positioning (same
 * pattern already established in Offers.tsx) — a plain `absolute` dropdown gets clipped, because the
 * table's `overflow-x-auto` wrapper forces `overflow-y` to `auto` too (CSS spec: setting one overflow
 * axis to non-visible computes the other to `auto` if it was `visible`), so any menu that would
 * render below the last visible row in a scrollable table is invisible without a portal.
 */
export function RowKebabMenu({ items }: { items: { label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    // Opening the menu often follows scrolling the row's kebab into view (e.g. a wide table's
    // horizontal scroll, or the click itself nudging layout) — attaching the scroll-close listener
    // on the same tick can catch that still-in-flight scroll and close the menu immediately after
    // it opens. Deferring registration by a frame lets any such trailing scroll settle first.
    let scrollListenerAttached = false;
    const raf = requestAnimationFrame(() => {
      window.addEventListener('scroll', onScroll, true);
      scrollListenerAttached = true;
    });
    return () => {
      document.removeEventListener('mousedown', onDown);
      cancelAnimationFrame(raf);
      if (scrollListenerAttached) window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" title="Actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="inline-grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-52 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {items.map((it) => (
            <button key={it.label} role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}
              className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
              {it.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** "{N} Total | first | prev | page | next | last" — matches the live reference's own pagination
 * footer exactly, backed by a real COUNT from the reporting query (see `total` on ReportResult). */
export function Pagination({ total, page, pageSize, onPageChange }: { total: number; page: number; pageSize: number; onPageChange: (p: number) => void }) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const btn = 'grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
  return (
    <div className="flex items-center gap-3 text-tiny text-fg-secondary">
      <span>{total.toLocaleString()} Total</span>
      <div className="flex items-center gap-1">
        <button type="button" title="First page" disabled={page <= 1} onClick={() => onPageChange(1)} className={btn}><ChevronsLeft size={14} /></button>
        <button type="button" title="Previous page" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} className={btn}><ChevronLeft size={14} /></button>
        <span className="px-1 text-fg">{page}</span>
        <button type="button" title="Next page" disabled={page >= lastPage} onClick={() => onPageChange(Math.min(lastPage, page + 1))} className={btn}><ChevronRight size={14} /></button>
        <button type="button" title="Last page" disabled={page >= lastPage} onClick={() => onPageChange(lastPage)} className={btn}><ChevronsRight size={14} /></button>
      </div>
    </div>
  );
}

export interface SavedReportConfig<OrderMetric extends string> {
  from: string; to: string; filters: FilterValues; exclusions: FilterValues; metricFilters: MetricFilters; ignoreFailTraffic: boolean;
  orderBy: OrderMetric; orderDir: 'asc' | 'desc'; hiddenColumns: string[];
}
export function loadSavedReports<OrderMetric extends string>(key: string): { name: string; config: SavedReportConfig<OrderMetric> }[] {
  try { return JSON.parse(localStorage.getItem(`tracker.savedReports.${key}`) ?? '[]'); } catch { return []; }
}
export function persistSavedReports<OrderMetric extends string>(key: string, list: { name: string; config: SavedReportConfig<OrderMetric> }[]): void {
  try { localStorage.setItem(`tracker.savedReports.${key}`, JSON.stringify(list)); } catch { /* best-effort */ }
}
