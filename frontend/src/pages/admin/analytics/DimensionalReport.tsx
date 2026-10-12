/**
 * Analytics › Dimensional — verified against the live reference (URL `/analytics/dimensional`) via a
 * full click-through: a date range, an "Add Dimensions" picker (up to 5 side-by-side breakdown
 * tables), a "Select Dimension Metric(s)" picker controlling which metric columns those tables show,
 * a real multi-select "click row to filter" cross-filter, sortable table columns, and a "Select
 * Chart(s)" bank of labeled single-metric trend charts.
 *
 * "Click row to filter" is genuinely multi-select PER dimension (confirmed live: clicking two Sub1
 * rows keeps both active — an IN-filter — and every *other* dimension's table + every chart narrows
 * to clicks/conversions matching any of the selected values; the source dimension's own table stays
 * unfiltered, with selected rows highlighted and a small filter icon, so you can keep picking more).
 * This needed the reporting engine's include filters (offer/publisher/advertiser/smartLink/country/
 * device/sub1-5) to accept an array, not just one value — added in api-backend/src/lib/reporting/
 * {types,request,postgres}.ts as `= ANY(...)` alongside the existing single-value `=` path, so every
 * other caller of the same filters is unaffected.
 *
 * The reference's full "Add Dimensions" list (scrolled through end-to-end) includes many fields this
 * app's schema doesn't have — Partner/Account Manager, Tracking Domain, Coupon Code, Carrier,
 * Category, ZIP, Language, Offer Group/URL, Creative, Source ID, Sub6-10, Adv1-10, Sales Manager,
 * Account Executive, Connection Type, Is Proxy, Attribution Method, Referred By, Click/Conversion
 * Error Code, Device Brand/Model/Platform, "OS Version" (only a coarse OS name is tracked, not a
 * version) — all omitted rather than faked. Kept: Offer, Partner, Advertiser, Smart Link, Country,
 * Device, City, Region, ISP, OS, Browser, Sub1-5 — City/Region/ISP/OS/Browser are new real
 * dimensions added to the reporting engine alongside the multi-value filter work, backed by real
 * `clicks` columns that existed but weren't previously exposed as a groupable/filterable dimension.
 *
 * No "Run Report": dates apply once they form a valid range (debounced, since the native date input
 * reports each typed segment); dimensions, metric/chart pickers and row cross-filters immediately.
 *
 * Money (Payout/Revenue/Profit) is in each row's own currency (`currencies` — lib/reportCurrency): a
 * row mixing currencies shows "Mixed", a money sort is per currency (the API's
 * `sortedWithinCurrency`, noted on the card), and a money chart whose points span currencies isn't
 * drawn — never a cross-currency sum.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, Filter, Plus, Search, X } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { daysAgo, todayStr, toIso, DASH, num } from '../../../shared-components/primitives/ReportPageKit';
import { combineCurrencies, currenciesOf, mixedTitle, resolveCurrency, showSortedWithinNote, withCurrenciesMetric, type RowCurrency } from '../../../lib/reportCurrency';
import { CurrencyNotes, Money } from '../../../shared-components/primitives/ReportMoney';
import { METRIC_KEYS, METRIC_LABELS, type MetricKey } from '../../../lib/customMetrics';
import { useReportOpts, type Opts } from '../Reports';
import { countryLabel } from '../../../data/geo';
import { useAutoDateRange } from '../reportView';
import { ReportCard, ReportControls, ControlField, DateRangeField, ClearButton, ResultsBar, ReportBody } from '../../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../../shared-components/primitives/reportControl';

interface AggRow { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }
interface AggResult { rows: AggRow[]; sortedWithinCurrency?: boolean }

const DIM_OPTIONS = [
  { key: 'sub1', label: 'Sub1', filterParam: 'sub1' },
  { key: 'sub2', label: 'Sub2', filterParam: 'sub2' },
  { key: 'sub3', label: 'Sub3', filterParam: 'sub3' },
  { key: 'sub4', label: 'Sub4', filterParam: 'sub4' },
  { key: 'sub5', label: 'Sub5', filterParam: 'sub5' },
  { key: 'offer', label: 'Offer', filterParam: 'offerId' },
  { key: 'publisher', label: 'Partner', filterParam: 'publisherId' },
  { key: 'advertiser', label: 'Advertiser', filterParam: 'advertiserId' },
  { key: 'smartLink', label: 'Smart Link', filterParam: 'smartLinkId' },
  { key: 'country', label: 'Country', filterParam: 'country' },
  { key: 'device', label: 'Device', filterParam: 'device' },
  { key: 'city', label: 'City', filterParam: 'city' },
  { key: 'region', label: 'Region', filterParam: 'region' },
  { key: 'isp', label: 'ISP', filterParam: 'isp' },
  { key: 'os', label: 'OS', filterParam: 'os' },
  { key: 'browser', label: 'Browser', filterParam: 'browser' },
] as const;
type DimKey = (typeof DIM_OPTIONS)[number]['key'];

const CHART_METRICS: { key: MetricKey; label: string }[] = [
  { key: 'clicks', label: 'Clicks' },
  { key: 'conversions', label: 'CV' },
  { key: 'payout', label: 'Payout' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'margin', label: 'Profit' },
];

type DimFilters = Partial<Record<DimKey, string[]>>;

const isMoneyMetric = (key: MetricKey) => key === 'payout' || key === 'revenue' || key === 'margin';

/** A metric cell: money in the row's currency ("Mixed" when its conversions mix currencies). */
function MetricValue({ metric, v, rc }: { metric: MetricKey; v: string | number | undefined; rc: RowCurrency }) {
  const n = num(v ?? 0);
  if (isMoneyMetric(metric)) return <Money value={n} rc={rc} />;
  if (metric === 'avg_fraud_score') return <>{n.toFixed(0)}</>;
  return <>{n.toLocaleString()}</>;
}

function resolveName(dim: DimKey, id: string | null, opts: Opts, smartLinkMap: Map<string, string>): string {
  if (id == null) return DASH;
  if (dim === 'offer') { const m = opts.offerMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'publisher') { const m = opts.pubMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'advertiser') { const m = opts.advMap.get(id); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : id.slice(0, 8) + '…'; }
  if (dim === 'smartLink') return smartLinkMap.get(id) ?? id.slice(0, 8) + '…';
  if (dim === 'country') return countryLabel(id);
  return id;
}

/** Add the query-string filter params from every OTHER dimension's active selection — a dimension
 * never filters its own table (so you can keep picking more rows from the full list).
 * Uuid dims (offer/publisher/advertiser/smartLink) go as comma lists. Text values can contain commas
 * ("Comcast Cable, LLC") and the API splits a plain comma list, so a text selection with any
 * comma-bearing value is sent as repeated `key[]=value` params, which the API takes literally (the `[]`
 * form also keeps a lone comma-bearing value intact). Comma-free text values go as one comma list —
 * read identically by the API, with no repeat-count limit. */
function appendOtherDimParams(params: URLSearchParams, filters: DimFilters, exclude?: DimKey): void {
  for (const opt of DIM_OPTIONS) {
    if (opt.key === exclude) continue;
    const vals = filters[opt.key];
    if (!vals || !vals.length) continue;
    if (/Id$/.test(opt.filterParam) || !vals.some((v) => v.includes(','))) params.set(opt.filterParam, vals.join(','));
    else for (const v of vals) params.append(`${opt.filterParam}[]`, v);
  }
}

function DimensionCard({
  dim, label, opts, smartLinkMap, from, to, dimMetrics, filters, onToggleRow, onClearDim, onRemove, currency,
}: {
  dim: DimKey; label: string; opts: Opts; smartLinkMap: Map<string, string>; from: string; to: string;
  /** The network's default currency — for rows without money-bearing conversions (and older APIs). */
  currency: string;
  dimMetrics: MetricKey[]; filters: DimFilters;
  onToggleRow: (dim: DimKey, value: string) => void; onClearDim: (dim: DimKey) => void; onRemove: () => void;
}) {
  const [q, setQ] = useState('');
  const [sortMetric, setSortMetric] = useState<MetricKey>(dimMetrics[0] ?? 'payout');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const params = new URLSearchParams({
    groupBy: dim, metrics: withCurrenciesMetric(dimMetrics.join(',')),
    from: toIso(from), to: toIso(to, true),
    orderBy: sortMetric, orderDir: sortDir, limit: '200',
  });
  appendOtherDimParams(params, filters, dim);
  const { data, loading, error } = useQuery<AggResult>(`/api/reports?${params.toString()}`);

  const selected = new Set(filters[dim] ?? []);
  const loadedRows = (data?.rows ?? [])
    .map((r) => ({ raw: r.dimensions[dim] ?? null, name: resolveName(dim, r.dimensions[dim] ?? null, opts, smartLinkMap), metrics: r.metrics, rc: resolveCurrency(currenciesOf(r.metrics), currency) }));
  const rows = loadedRows.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));

  const toggleSort = (m: MetricKey) => {
    if (sortMetric === m) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortMetric(m); setSortDir('desc'); }
  };

  return (
    <ReportCard>
      <ResultsBar position="top" title={label} loading={loading} actions={<>
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className={`input ${CONTROL} !pl-8 sm:!w-44`} placeholder="Search this page…" title="Filters only the rows on the current page (the top 200 loaded here)"
            aria-label={`Search ${label}`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" onClick={onRemove} title="Remove dimension" aria-label={`Remove ${label}`}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-muted hover:bg-accent-subtle hover:text-danger-text">
          <X size={14} />
        </button>
      </>}>
        {selected.size > 0 && <button type="button" onClick={() => onClearDim(dim)} className="whitespace-nowrap text-tiny font-medium text-accent-text hover:underline">Clear filter</button>}
        <CurrencyNotes sortedWithin={showSortedWithinNote(data?.sortedWithinCurrency, loadedRows.map((r) => r.rc))} />
      </ResultsBar>
      <ReportBody>
        {loading ? <Spinner /> : error ? <p className="text-small text-danger-text">{error}</p>
          : rows.length === 0 ? <p className="text-small text-fg-muted">No Data Available</p>
          : (
            <table className="premium-table">
              <thead className="text-tiny uppercase text-fg-muted">
                <tr>
                  <th className="w-5 py-1.5" />
                  <th className="py-1.5">Name</th>
                  {dimMetrics.map((m) => (
                    <th key={m} className="cursor-pointer select-none py-1.5 text-right hover:text-fg" onClick={() => toggleSort(m)}>
                      {METRIC_LABELS[m]} {sortMetric === m ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isSelected = r.raw != null && selected.has(r.raw);
                  const dimmed = selected.size > 0 && !isSelected;
                  return (
                    <tr key={i}
                      className={`cursor-pointer ${isSelected ? 'bg-accent-subtle' : 'hover:bg-accent-subtle/40'}`}
                      onClick={() => r.raw != null && onToggleRow(dim, r.raw)}>
                      <td className="py-1.5">{isSelected && <Filter size={11} className="text-accent-text" />}</td>
                      <td className={`max-w-[200px] truncate py-1.5 ${dimmed ? 'text-fg-muted' : 'text-fg'}`}>{r.name}</td>
                      {dimMetrics.map((m) => <td key={m} className={`py-1.5 text-right tabular-nums ${dimmed ? 'text-fg-muted' : 'text-fg-secondary'}`}><MetricValue metric={m} v={r.metrics[m]} rc={r.rc} /></td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </ReportBody>
    </ReportCard>
  );
}

/** `unavailable`: why the series isn't drawn (e.g. its points mix currencies) — shown in its place. */
function LabeledChart({ label, labels, values, unavailable }: { label: string; labels: string[]; values: number[]; unavailable?: { text: string; title: string } }) {
  const hasData = values.length > 0 && values.some((v) => v > 0);
  const w = 560, h = 180, padL = 44, padR = 12, padT = 10, padB = 20;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const n = Math.max(1, values.length);
  const max = Math.max(1, ...values);
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = values.length ? `${line} L${x(n - 1).toFixed(1)},${padT + plotH} L${x(0).toFixed(1)},${padT + plotH} Z` : '';
  const step = Math.max(1, Math.ceil(n / 6));

  return (
    <div>
      <p className="mb-1 text-small font-medium text-fg">{label}</p>
      {unavailable ? (
        <div className="grid h-[100px] place-items-center rounded-[var(--radius)] border border-dashed border-border">
          <p className="text-tiny text-fg-muted" title={unavailable.title}>{unavailable.text}</p>
        </div>
      ) : !hasData ? (
        <div className="grid h-[100px] place-items-center rounded-[var(--radius)] border border-dashed border-border">
          <p className="text-tiny text-fg-muted">No data for this period</p>
        </div>
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height: 140 }}>
          {[0, 0.5, 1].map((f) => (
            <text key={f} x={padL - 6} y={padT + plotH * (1 - f) + 3} fontSize={9} textAnchor="end" fill="rgb(var(--text-secondary))">
              {Math.round(max * f).toLocaleString()}
            </text>
          ))}
          <path d={area} fill="rgb(var(--accent-text))" opacity={0.15} />
          <path d={line} fill="none" stroke="rgb(var(--accent-text))" strokeWidth={1.5} />
          {labels.map((l, i) => (i % step === 0 ? (
            <text key={i} x={x(i)} y={h - 4} fontSize={9} textAnchor="middle" fill="rgb(var(--text-secondary))">{l}</text>
          ) : null))}
        </svg>
      )}
    </div>
  );
}

/** Multi-select picker as a 40 px control-row field — the label comes from the surrounding ControlField. */
function MultiSelectDropdown<T extends string>({
  id, allOptions, optionLabels, selected, onChange, max,
}: { id: string; allOptions: readonly T[]; optionLabels: Record<T, string>; selected: T[]; onChange: (v: T[]) => void; max?: number }) {
  const [open, setOpen] = useState(false);
  const toggle = (k: T) => onChange(selected.includes(k) ? selected.filter((x) => x !== k) : (!max || selected.length < max) ? [...selected, k] : selected);
  return (
    <div className="relative">
      <button id={id} type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`input ${CONTROL} flex min-w-0 items-center gap-1.5 whitespace-nowrap text-left`}>
        <span className="min-w-0 flex-1 truncate">{selected.map((s) => optionLabels[s]).join(', ') || 'None'}</span>
        <span className="shrink-0 text-tiny text-fg-muted">{selected.length}/{max ?? allOptions.length}</span>
        <ChevronDown size={13} className="shrink-0 text-fg-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-56 overflow-y-auto rounded-card border border-border bg-elevated py-1 shadow-elevated">
            {allOptions.map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small text-fg hover:bg-accent-subtle">
                <input type="checkbox" className="chk" checked={selected.includes(k)} onChange={() => toggle(k)} />
                {optionLabels[k]}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DimensionalReport() {
  const opts = useReportOpts();
  const smartLinkMap = useMemo(() => new Map(opts.smartLinks.map((s) => [s.value, s.label])), [opts.smartLinks]);

  // Dates apply on their own once they form a valid range (see useAutoDateRange) — never a
  // half-typed or inverted range reaching the API; everything else applies immediately.
  const range = useAutoDateRange(todayStr(), todayStr());
  const { appliedFrom, appliedTo } = range;
  const [dims, setDims] = useState<DimKey[]>(['sub1', 'offer']);
  const [dimMetrics, setDimMetrics] = useState<MetricKey[]>(['payout', 'conversions']);
  const [charts, setCharts] = useState<MetricKey[]>(['clicks', 'conversions', 'payout', 'revenue', 'margin']);
  const [dimPickerOpen, setDimPickerOpen] = useState(false);
  const [filters, setFilters] = useState<DimFilters>({});
  const { data: settings } = useQuery<{ general?: { defaultCurrency?: string } }>('/api/settings');
  const currency = settings?.general?.defaultCurrency ?? 'USD';

  const addDim = (k: DimKey) => { if (dims.length < 5 && !dims.includes(k)) setDims([...dims, k]); setDimPickerOpen(false); };
  const removeDim = (k: DimKey) => { setDims(dims.filter((d) => d !== k)); setFilters((f) => { const n = { ...f }; delete n[k]; return n; }); };
  // Reset dates, dimensions and row filters in one render. The debounced range catches up to the
  // same values later and is then a no-op.
  const clearAll = () => { range.reset({ from: todayStr(), to: todayStr() }); setDims([]); setFilters({}); };
  const clearDim = (k: DimKey) => setFilters((f) => { const n = { ...f }; delete n[k]; return n; });
  const toggleRow = (dim: DimKey, value: string) => setFilters((f) => {
    const cur = f[dim] ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    const n = { ...f };
    if (next.length) n[dim] = next; else delete n[dim];
    return n;
  });

  const activeDims = (Object.keys(filters) as DimKey[]).filter((k) => (filters[k]?.length ?? 0) > 0);

  const chronological = appliedFrom !== appliedTo;
  const chartGroupBy = chronological ? 'day' : 'hour';
  const chartsParams = new URLSearchParams({
    groupBy: chartGroupBy, metrics: withCurrenciesMetric(charts.join(',')),
    from: toIso(appliedFrom), to: toIso(appliedTo, true), limit: '200',
  });
  appendOtherDimParams(chartsParams, filters);
  // No chart selected → nothing to request (the body says so).
  const chartsQ = useQuery<AggResult>(charts.length ? `/api/reports?${chartsParams.toString()}` : null);
  const chartRows = [...(chartsQ.data?.rows ?? [])].sort((a, b) => (a.dimensions[chartGroupBy] ?? '').localeCompare(b.dimensions[chartGroupBy] ?? ''));
  const chartLabels = chartRows.map((r) => {
    const iso = r.dimensions[chartGroupBy] ?? '';
    if (!iso) return '';
    const d = new Date(iso);
    return chronological ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : `${String(d.getUTCHours()).padStart(2, '0')}:00`;
  });
  // One money series across points in different currencies would plot unlike amounts on one axis —
  // a money chart is drawn only when its points share one currency (labelled with it).
  const chartRc = combineCurrencies(chartRows.map((r) => currenciesOf(r.metrics)), currency);
  const chartLabel = (c: { key: MetricKey; label: string }) =>
    isMoneyMetric(c.key) && chartRc.kind === 'single' ? `${c.label} (${chartRc.currency})` : c.label;
  const chartUnavailable = (c: { key: MetricKey }) =>
    isMoneyMetric(c.key) && chartRc.kind === 'mixed' ? { text: 'Not plotted — mixed currencies', title: mixedTitle(chartRc.currencies) } : undefined;

  return (
    <>
      <ReportCard className="mb-4">
        <ReportControls problem={range.problem} actions={<ClearButton onClick={clearAll} title="Reset dates, dimensions and row filters" />}>
          <DateRangeField idPrefix="dimensional-report" from={range.from} to={range.to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
          <button type="button" className={`inline-flex items-center px-1 text-small font-medium text-accent-text hover:underline ${CONTROL}`}
            onClick={() => range.reset({ from: daysAgo(6), to: todayStr() })}>Last 7 Days</button>
          <ControlField label="Dimension Metrics" htmlFor="dimensional-report-metrics">
            <MultiSelectDropdown id="dimensional-report-metrics" allOptions={METRIC_KEYS} optionLabels={METRIC_LABELS} selected={dimMetrics} onChange={(v) => setDimMetrics(v.length ? v : dimMetrics)} />
          </ControlField>
          <ControlField label="Charts" htmlFor="dimensional-report-charts">
            <MultiSelectDropdown id="dimensional-report-charts" allOptions={CHART_METRICS.map((c) => c.key)} optionLabels={Object.fromEntries(CHART_METRICS.map((c) => [c.key, c.label])) as Record<MetricKey, string>} selected={charts} onChange={setCharts} />
          </ControlField>
          <ControlField label="Dimensions" htmlFor="dimensional-report-add-dim" className="w-full sm:w-auto">
            <div className="flex min-h-10 flex-wrap items-center gap-2">
              <div className="relative">
                <button id="dimensional-report-add-dim" type="button" className={`btn-ghost ${CONTROL} flex items-center gap-1.5`} onClick={() => setDimPickerOpen((o) => !o)} disabled={dims.length >= 5}>
                  <Plus size={15} /> Add Dimensions <span className="text-fg-muted">{dims.length}/5</span>
                </button>
                {dimPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setDimPickerOpen(false)} />
                    <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-52 overflow-y-auto rounded-card border border-border bg-elevated p-1 shadow-elevated">
                      {DIM_OPTIONS.filter((d) => !dims.includes(d.key)).map((d) => (
                        <button key={d.key} onClick={() => addDim(d.key)} className="block w-full rounded-[var(--radius)] px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">{d.label}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {dims.map((d) => (
                <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-3 py-1 text-tiny font-medium text-accent-text">
                  {DIM_OPTIONS.find((o) => o.key === d)?.label}
                  <button type="button" onClick={() => removeDim(d)} aria-label={`Remove ${DIM_OPTIONS.find((o) => o.key === d)?.label ?? d}`}><X size={12} /></button>
                </span>
              ))}
            </div>
          </ControlField>
        </ReportControls>
        {activeDims.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-4 sm:px-6">
            <span className="text-small font-medium text-fg-secondary">Filtering by</span>
            {activeDims.map((d) => (
              <span key={d} className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle py-1 pl-3 pr-1.5 text-tiny font-medium text-accent-text">
                {DIM_OPTIONS.find((o) => o.key === d)?.label}
                <span className="text-accent-text/70">{(filters[d] ?? []).length}</span>
                <button type="button" onClick={() => clearDim(d)} className="grid h-4 w-4 place-items-center rounded-full hover:bg-elevated hover:text-danger-text"><X size={11} /></button>
              </span>
            ))}
            <button type="button" onClick={() => setFilters({})} className="text-tiny font-medium text-accent-text hover:underline">Clear all</button>
          </div>
        )}
      </ReportCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-h3 font-medium text-fg">Dimensional Breakdown</h2>
            <p className="text-tiny text-fg-muted">Click row to filter</p>
          </div>

          {dims.length === 0 ? <StateBlock>Add at least one dimension to see a breakdown.</StateBlock> : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {dims.map((d) => (
                <DimensionCard key={d} dim={d} label={DIM_OPTIONS.find((o) => o.key === d)?.label ?? d} opts={opts} smartLinkMap={smartLinkMap}
                  from={appliedFrom} to={appliedTo} dimMetrics={dimMetrics} filters={filters} onToggleRow={toggleRow} onClearDim={clearDim} onRemove={() => removeDim(d)} currency={currency} />
              ))}
            </div>
          )}
        </div>

        <ReportCard className="self-start">
          <ResultsBar position="top" title="Charts" loading={chartsQ.loading} />
          <ReportBody>
            <div className="space-y-5">
              {charts.length === 0 ? <p className="text-small text-fg-muted">No charts selected — pick at least one under Charts.</p>
                : chartsQ.loading ? <Spinner />
                : chartsQ.error ? <p className="text-small text-danger-text">{chartsQ.error}</p>
                : CHART_METRICS.filter((c) => charts.includes(c.key)).map((c) => (
                  <LabeledChart key={c.key} label={chartLabel(c)} labels={chartLabels} values={chartRows.map((r) => num(r.metrics[c.key] ?? 0))} unavailable={chartUnavailable(c)} />
                ))}
            </div>
          </ReportBody>
        </ReportCard>
      </div>
    </>
  );
}
