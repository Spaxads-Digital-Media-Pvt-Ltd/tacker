/**
 * Analytics › Funnel — verified against the live reference (URL `/analytics/funnels`, "Funnel
 * Report": date range, Funnel Type* fixed to "Offer Level Events", Target* [a single Offer], Child*
 * [breakdown dimension, default Partner], "Include Media Buying Costs" checkbox, Add Events* [multi-
 * select, minimum 2, disabled until Target is set], Add Filter, Run Report — described in the
 * reference's own Analytics flyout as "Track how Events lead to conversions for a specific Offer. Get
 * a clear view of the steps and how they connect.").
 *
 * Unlike Redirect/Partner Referrals/Products/Refunds, this one IS real: this app has genuine
 * multi-goal offers (`offer_goals` — e.g. an offer can define "Registration" then "FTD" as named
 * events, confirmed live on Offer Detail's "Revenue & Payout (Events)" card,
 * pages/admin/offerDetail/GeneralTab.tsx) and the tracking surface actually resolves and stores which
 * goal a conversion satisfied (`conversions.goal_id`, api-backend/src/surfaces/tracking/
 * conversions/record.ts `resolveGoal`) — confirmed against the real seed data: 2 offers ("TEST OFFER -
 * 1": Registration → FTD, "Acme US CPA": Purchase → Install) each have 2 goals, and 25 of 52 real
 * conversions carry a real goal_id. So a funnel of "how many conversions hit each named Event for this
 * Offer" is genuinely backed — new endpoint GET /api/reports/funnel (api-backend/.../detail-reports.ts)
 * counts real approved conversions per selected goal_id, with an optional breakdown by one real
 * click-side dimension (Partner/Country/Device/City/Region/ISP/OS/Browser/Sub1-5 — the same dimension
 * set already established for Dimensional/Flex/Dynamic Nested/Variance; Offer/Advertiser/Smart Link are
 * omitted as Child choices here since the Offer is already fixed by Target).
 *
 * "Funnel Type" has only one real option (Offer Level Events — this app has no other funnel input to
 * offer) so it's shown as a fixed label rather than a fake dropdown. "Include Media Buying Costs" is
 * real UI but inert: this app has no media buying cost data anywhere (same dash convention as every
 * other report's "Media Buying Cost" tile).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, MoreVertical, Search } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../../components/ui';
import { FilterButton, type FilterCategory, type FilterValues } from '../../../components/CategorizedFilters';
import { ApiRequestModal } from '../../../components/TableActionsKit';
import {
  DASH, DEVICES, daysAgo, todayStr,
  type MetricFilters, reportingFiltersCount, ReportingFiltersFlyout,
} from '../../../components/ReportPageKit';
import { useReportOpts, type Opts } from '../Reports';

interface Goal { id: string; name: string; eventName: string | null; isDefault: boolean; sortOrder: number }
interface FunnelResult { stages: { goalId: string; count: number }[]; breakdown: { key: string; counts: Record<string, number> }[] }

const CHILD_DIM_OPTIONS = [
  { key: 'publisher', label: 'Partner', filterParam: 'publisherId' },
  { key: 'country', label: 'Country', filterParam: 'country' },
  { key: 'device', label: 'Device', filterParam: 'device' },
  { key: 'city', label: 'City', filterParam: 'city' },
  { key: 'region', label: 'Region', filterParam: 'region' },
  { key: 'isp', label: 'ISP', filterParam: 'isp' },
  { key: 'os', label: 'OS', filterParam: 'os' },
  { key: 'browser', label: 'Browser', filterParam: 'browser' },
  { key: 'sub1', label: 'Sub1', filterParam: 'sub1' },
  { key: 'sub2', label: 'Sub2', filterParam: 'sub2' },
  { key: 'sub3', label: 'Sub3', filterParam: 'sub3' },
  { key: 'sub4', label: 'Sub4', filterParam: 'sub4' },
  { key: 'sub5', label: 'Sub5', filterParam: 'sub5' },
] as const;
type ChildDim = (typeof CHILD_DIM_OPTIONS)[number]['key'];

function resolveChildName(dim: ChildDim, raw: string, opts: Opts): string {
  if (dim === 'publisher') { const m = opts.pubMap.get(raw); return m ? `${m.ref != null ? `(${m.ref}) ` : ''}${m.name}` : raw.slice(0, 8) + '…'; }
  return raw;
}
function linkForChild(dim: ChildDim, raw: string): string | null {
  return dim === 'publisher' ? `/app/publishers/${raw}` : null;
}

function OfferPicker({ value, onChange, opts }: { value: string | null; onChange: (id: string) => void; opts: Opts }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = opts.offers.find((o) => o.value === value);
  const filtered = opts.offers.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="relative">
      <label className="label mb-1 block">Target <span className="text-danger-text">*</span></label>
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex !w-64 items-center justify-between !py-2 text-left">
        <span className="truncate">{selected ? selected.label : 'None'}</span> <ChevronDown size={13} className="shrink-0 text-fg-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-80 rounded-card border border-border bg-elevated shadow-elevated">
            <div className="relative border-b border-border px-3 py-2">
              <Search size={13} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input className="input !pl-7" placeholder="Search Offer…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {filtered.length === 0 && <p className="px-3 py-3 text-small text-fg-muted">No offers.</p>}
              {filtered.map((o) => (
                <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); setQ(''); }}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-small hover:bg-accent-subtle ${o.value === value ? 'text-accent-text' : 'text-fg'}`}>
                  {o.value === value && '✓'} {o.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ChildPicker({ value, onChange }: { value: ChildDim; onChange: (k: ChildDim) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <label className="label mb-1 block">Child <span className="text-danger-text">*</span></label>
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between !py-2 text-left">
        {CHILD_DIM_OPTIONS.find((d) => d.key === value)?.label} <ChevronDown size={13} className="text-fg-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 max-h-72 w-44 overflow-y-auto rounded-card border border-border bg-elevated py-1 shadow-elevated">
            {CHILD_DIM_OPTIONS.map((d) => (
              <button key={d.key} onClick={() => { onChange(d.key); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-small hover:bg-accent-subtle ${d.key === value ? 'text-accent-text' : 'text-fg'}`}>
                {d.key === value && '✓'} {d.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EventsPicker({ goals, selected, onChange, disabled }: { goals: Goal[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="relative">
      <label className="label mb-1 block">Add Events <span className="text-danger-text">*</span></label>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
        className="input flex !w-64 items-center justify-between !py-2 text-left disabled:cursor-not-allowed disabled:opacity-60">
        <span className="truncate">{selected.length ? `${selected.length} selected` : 'Select Events…'}</span> <ChevronDown size={13} className="shrink-0 text-fg-muted" />
      </button>
      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-72 rounded-card border border-border bg-elevated shadow-elevated">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-tiny">
              <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => onChange(goals.map((g) => g.id))}>Select All</button>
              <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => onChange([])}>Clear All</button>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {goals.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-small text-fg hover:bg-accent-subtle">
                  <input type="checkbox" className="chk" checked={selected.includes(g.id)} onChange={() => toggle(g.id)} />
                  {g.name}{g.isDefault ? ' (Default)' : ''}
                </label>
              ))}
            </div>
            {selected.length < 2 && <p className="border-t border-border px-3 py-2 text-tiny text-fg-muted">You must select a minimum of 2 Events.</p>}
          </div>
        </>
      )}
    </div>
  );
}

export default function FunnelReport() {
  const opts = useReportOpts();

  const [offerId, setOfferId] = useState<string | null>(null);
  const [childDim, setChildDim] = useState<ChildDim>('publisher');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());
  const [includeMbc, setIncludeMbc] = useState(false);
  const [selectedGoalIds, setSelectedGoalIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterValues>({});
  const [exclusions, setExclusions] = useState<FilterValues>({});
  const [metricFilters, setMetricFilters] = useState<MetricFilters>({});
  const [ignoreFailTraffic, setIgnoreFailTraffic] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);

  const [applied, setApplied] = useState<{
    offerId: string; childDim: ChildDim; from: string; to: string; goalIds: string[]; filters: FilterValues;
  } | null>(null);

  const { data: goalsData } = useQuery<Goal[]>(offerId ? `/api/offers/${offerId}/goals` : null);
  const goals = useMemo(() => [...(goalsData ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [goalsData]);
  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  const { data: countryAgg } = useQuery<{ rows: { dimensions: Record<string, string | null> }[] }>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => (countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country']).filter((c): c is string => Boolean(c)).sort()
    .map((c) => ({ value: c, label: c })), [countryAgg]);
  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'partner', label: 'Partner', options: opts.publishers },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICES.map((d) => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) })) },
  ], [opts.publishers, countryOptions]);

  const canRun = !!offerId && selectedGoalIds.length >= 2;
  const runReport = () => {
    if (!canRun || !offerId) return;
    setApplied({ offerId, childDim, from, to, goalIds: selectedGoalIds, filters });
  };
  const clearAll = () => {
    setOfferId(null); setChildDim('publisher'); setFrom(daysAgo(30)); setTo(todayStr());
    setIncludeMbc(false); setSelectedGoalIds([]); setFilters({}); setExclusions({}); setMetricFilters({}); setIgnoreFailTraffic(false);
    setApplied(null);
  };

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const funnelQs = applied ? qs({
    offerId: applied.offerId, goalIds: applied.goalIds.join(','), from: applied.from, to: applied.to, childDim: applied.childDim,
    publisherId: applied.filters['partner']?.[0], country: applied.filters['country']?.[0], device: applied.filters['device']?.[0],
  }) : '';
  const { data, loading, error } = useQuery<FunnelResult>(applied ? `/api/reports/funnel?${funnelQs}` : null);

  const stages = useMemo(() => (data?.stages ?? []).map((s) => ({ ...s, goal: goalById.get(s.goalId) })), [data, goalById]);
  const firstCount = stages[0]?.count ?? 0;
  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  const breakdownRows = useMemo(() => (data?.breakdown ?? []).map((b) => ({
    key: b.key, name: applied ? resolveChildName(applied.childDim, b.key, opts) : b.key, counts: b.counts,
  })), [data, applied, opts]);

  return (
    <>
      <PageHeader title="Funnel Report" subtitle="Analytics › Funnel" action={
        <button type="button" title="Page Actions" onClick={() => setShowApiRequest(true)}
          className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
          <MoreVertical size={15} />
        </button>
      } />

      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label mb-1 block">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">To</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">Funnel Type</label>
            <div className="input flex !w-44 items-center !py-2 text-fg-secondary">Offer Level Events</div>
          </div>
          <OfferPicker value={offerId} onChange={(id) => { setOfferId(id); setSelectedGoalIds([]); }} opts={opts} />
          <ChildPicker value={childDim} onChange={setChildDim} />
          <EventsPicker goals={goals} selected={selectedGoalIds} onChange={setSelectedGoalIds} disabled={!offerId} />
          <div className="relative">
            <FilterButton
              count={reportingFiltersCount({ filters, exclusions, metricFilters, ignoreFailTraffic })}
              onClick={() => setFilterOpen((o) => !o)}
            />
            {filterOpen && (
              <ReportingFiltersFlyout
                dimCategories={FILTER_CATEGORIES}
                value={{ filters, exclusions, metricFilters, ignoreFailTraffic }}
                onApply={(v) => { setFilters(v.filters); setExclusions(v.exclusions); setMetricFilters(v.metricFilters); setIgnoreFailTraffic(v.ignoreFailTraffic); }}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </div>
          <button type="button" className="text-small font-medium text-accent-text hover:underline" onClick={clearAll}>Clear</button>
        </div>
        <label title="Not available yet" className="flex w-fit cursor-not-allowed items-center gap-2 text-small text-fg-muted">
          <input type="checkbox" className="chk" checked={includeMbc} disabled onChange={() => setIncludeMbc((v) => !v)} />
          Include Media Buying Costs
        </label>
        <button type="button" className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50" onClick={runReport} disabled={!canRun}>Run Report</button>
      </div>

      <div className="card">
        {!applied ? <StateBlock>Set Parameters and Run Report</StateBlock>
          : loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !stages.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <>
              <h3 className="mb-4 text-h3 font-medium text-fg">Funnel</h3>
              <div className="mb-8 space-y-2">
                {stages.map((s, i) => {
                  const widthPct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
                  const ofFirstPct = firstCount > 0 ? (s.count / firstCount) * 100 : 0;
                  const prevCount = i > 0 ? stages[i - 1]!.count : null;
                  const dropoffPct = prevCount && prevCount > 0 ? ((prevCount - s.count) / prevCount) * 100 : null;
                  return (
                    <div key={s.goalId}>
                      {i > 0 && dropoffPct != null && (
                        <p className="pl-2 text-tiny text-fg-muted">↓ {dropoffPct.toFixed(1)}% drop-off</p>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="w-40 shrink-0 truncate text-small text-fg">{s.goal?.name ?? s.goalId.slice(0, 8)}</span>
                        <div className="h-8 flex-1 rounded-[var(--radius)] bg-page">
                          <div className="flex h-8 items-center justify-end rounded-[var(--radius)] bg-accent px-3 text-tiny font-semibold text-white transition-all"
                            style={{ width: `${Math.max(widthPct, 6)}%` }}>
                            {s.count.toLocaleString()}
                          </div>
                        </div>
                        <span className="w-16 shrink-0 text-right text-tiny text-fg-muted">{ofFirstPct.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <h3 className="mb-3 text-h3 font-medium text-fg">Detailed Report</h3>
              {!breakdownRows.length ? <p className="text-small text-fg-muted">No activity for this period.</p> : (
                <div className="overflow-x-auto rounded-card border border-border">
                  <table className="w-full min-w-[720px] text-left text-body">
                    <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                      <tr>
                        <th className="whitespace-nowrap px-4 py-3 font-semibold">{CHILD_DIM_OPTIONS.find((d) => d.key === applied.childDim)?.label}</th>
                        {stages.map((s) => <th key={s.goalId} className="whitespace-nowrap px-4 py-3 text-right font-semibold">{s.goal?.name ?? DASH}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {breakdownRows.map((r) => {
                        const url = linkForChild(applied.childDim, r.key);
                        return (
                          <tr key={r.key} className="hover:bg-accent-subtle/40">
                            <td className="whitespace-nowrap px-4 py-3">
                              {url ? <Link to={url} className="text-accent-text hover:underline">{r.name}</Link> : r.name}
                            </td>
                            {applied.goalIds.map((gid) => (
                              <td key={gid} className="px-4 py-3 text-right">{(r.counts[gid] ?? 0).toLocaleString()}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
      </div>

      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={applied ? `/api/reports/funnel?${funnelQs}` : '/api/reports/funnel'} appliedFilters={{
        offer: applied?.offerId, from: applied?.from, to: applied?.to, child: applied?.childDim, events: applied?.goalIds.join(','),
      }} />}
    </>
  );
}
