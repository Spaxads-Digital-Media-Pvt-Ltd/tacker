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
 * offer) so it's shown as plain text rather than a fake dropdown. The reference's "Include Media
 * Buying Costs" checkbox is omitted: this app has no media buying cost data anywhere (same dash
 * convention as every other report's "Media Buying Cost" tile).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, MoreVertical, Search } from 'lucide-react';
import { useQuery } from '../../../lib/useApi';
import { uaDimensionLabel } from '../../../lib/userAgentDisplay';
import { PageHeader, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { type FilterCategory, type FilterValues } from '../../../shared-components/primitives/CategorizedFilters';
import { ApiRequestModal } from '../../../shared-components/primitives/TableActionsKit';
import {
  DASH, DEVICE_OPTIONS,
  reportingFiltersCount, ReportingFiltersFlyout, type ReportingFiltersValue, EMPTY_REPORTING_FILTERS,
} from '../../../shared-components/primitives/ReportPageKit';
import { useReportOpts, type Opts } from '../Reports';
import { countryLabel } from '../../../data/geo';
import { ActiveFilterChips } from '../../../shared-components/primitives/ActiveFilterChips';
import { chipsFromValues, withoutValue } from '../../../lib/filterChips';
import { useAutoDateRange } from '../reportView';
import { ReportCard, ReportControls, DateRangeField, FiltersButton, ClearButton, ResultsBar, ReportBody } from '../../../shared-components/primitives/ReportLayout';
import { REPORT_CONTROL as CONTROL } from '../../../shared-components/primitives/reportControl';
import { useReportZone } from '../../../lib/useReportZone';

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
  return uaDimensionLabel(dim, raw);
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
      <label className="label">Target <span className="text-danger-text">*</span></label>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`input flex !w-64 items-center justify-between text-left ${CONTROL}`}>
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
      <label className="label">Child <span className="text-danger-text">*</span></label>
      <button type="button" onClick={() => setOpen((o) => !o)} className={`input flex items-center justify-between text-left ${CONTROL}`}>
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
      <label className="label">Add Events <span className="text-danger-text">*</span></label>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={`input flex !w-64 items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-60 ${CONTROL}`}>
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

  // No "Run Report": dates apply on their own once they form a valid range (debounced, see
  // useAutoDateRange); Target / Child / Events / Filters apply immediately. The funnel is requested
  // only while it can run (a Target and at least 2 Events), and reloads once per change after that.
  // D7: the report's time zone — the network's unless one is picked beside the dates: its days,
  // "today" and the presets; requests send plain dates + tz.
  const zone = useReportZone();
  const range = useAutoDateRange(zone.daysAgo(30), zone.today());
  const [offerId, setOfferId] = useState<string | null>(null);
  const [childDim, setChildDim] = useState<ChildDim>('publisher');
  const [selectedGoalIds, setSelectedGoalIds] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterValues>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);

  const { data: goalsData } = useQuery<Goal[]>(offerId ? `/api/offers/${offerId}/goals` : null);
  const goals = useMemo(() => [...(goalsData ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [goalsData]);
  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  const { data: countryAgg } = useQuery<{ rows: { dimensions: Record<string, string | null> }[] }>('/api/reports?groupBy=country&metrics=clicks&limit=200');
  const countryOptions = useMemo(() => (countryAgg?.rows ?? [])
    .map((r) => r.dimensions['country']).filter((c): c is string => Boolean(c)).sort()
    .map((c) => ({ value: c, label: countryLabel(c) })).sort((a, b) => a.label.localeCompare(b.label)), [countryAgg]);
  const FILTER_CATEGORIES: FilterCategory[] = useMemo(() => [
    { key: 'partner', label: 'Partner', options: opts.publishers },
    { key: 'country', label: 'Country', options: countryOptions },
    { key: 'device', label: 'Device', options: DEVICE_OPTIONS },
  ], [opts.publishers, countryOptions]);
  // The funnel endpoint honours only the dimension filters (the flyout shows just that section).
  const reporting: ReportingFiltersValue = { ...EMPTY_REPORTING_FILTERS, filters };

  const canRun = !!offerId && selectedGoalIds.length >= 2;
  // Dates, pickers and filters reset in one render → at most one request.
  const clearAll = () => {
    range.reset({ from: zone.daysAgo(30), to: zone.today() });
    setOfferId(null); setChildDim('publisher'); setSelectedGoalIds([]); setFilters({});
  };

  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') params.set(k, String(v));
    return params.toString();
  };
  const funnelQs = canRun ? qs({
    offerId: offerId ?? undefined, goalIds: selectedGoalIds.join(','), ...zone.range(range.appliedFrom, range.appliedTo), childDim,
    publisherId: filters['partner']?.[0], country: filters['country']?.[0], device: filters['device']?.[0],
  }) : '';
  const { data, loading, error } = useQuery<FunnelResult>(canRun ? `/api/reports/funnel?${funnelQs}` : null);

  const stages = useMemo(() => (data?.stages ?? []).map((s) => ({ ...s, goal: goalById.get(s.goalId) })), [data, goalById]);
  const firstCount = stages[0]?.count ?? 0;
  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  const breakdownRows = useMemo(() => (data?.breakdown ?? []).map((b) => ({
    key: b.key, name: resolveChildName(childDim, b.key, opts), counts: b.counts,
  })), [data, childDim, opts]);

  return (
    <>
      <PageHeader title="Funnel Report" subtitle="Analytics › Funnel" />

      <ReportCard>
        <ReportControls problem={range.problem} actions={<>
          <ClearButton onClick={clearAll} title="Reset dates, target, events and filters" />
          <FiltersButton count={reportingFiltersCount(reporting)} onClick={() => setFilterOpen((o) => !o)}>
            {filterOpen && (
              <ReportingFiltersFlyout
                sections={['filters']} singleSelect
                dimCategories={FILTER_CATEGORIES}
                value={reporting}
                onApply={(v) => setFilters(v.filters)}
                onClose={() => setFilterOpen(false)}
              />
            )}
          </FiltersButton>
          <button type="button" title="Page Actions" aria-label="Show API Request" onClick={() => setShowApiRequest(true)}
            className="grid h-10 w-10 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
            <MoreVertical size={15} />
          </button>
        </>}>
          <DateRangeField idPrefix="funnel-report" from={range.from} to={range.to} max={zone.today()} zone={zone} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
          <div>
            <span className="label">Funnel Type</span>
            <p className="flex h-10 items-center text-small text-fg-secondary">Offer Level Events</p>
          </div>
          <OfferPicker value={offerId} onChange={(id) => { setOfferId(id); setSelectedGoalIds([]); }} opts={opts} />
          <ChildPicker value={childDim} onChange={setChildDim} />
          <EventsPicker goals={goals} selected={selectedGoalIds} onChange={setSelectedGoalIds} disabled={!offerId} />
        </ReportControls>

        <ResultsBar title="Funnel" loading={loading}>
          <ActiveFilterChips chips={chipsFromValues(FILTER_CATEGORIES, filters)}
            onRemove={(c) => setFilters(withoutValue(filters, c.key, c.value))}
            onClearAll={() => setFilters({})} />
        </ResultsBar>

        <ReportBody>
        {!canRun ? <StateBlock>Pick a target offer and at least 2 events to build the funnel.</StateBlock>
          // `!data && !error`: the render where the request is about to start (useQuery sets loading in an effect).
          : loading || (!data && !error) ? <StateBlock><Spinner /></StateBlock>
          // A failed request keeps the previous `data` in useQuery — the error wins, never stale stages.
          : error ? <StateBlock>{error}</StateBlock>
          : !stages.length ? <StateBlock>No Record Found</StateBlock>
          : (
            <>
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
                          <div className="flex h-8 items-center justify-end rounded-[var(--radius)] bg-accent px-3 text-tiny font-semibold text-on-accent transition-all"
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
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th >{CHILD_DIM_OPTIONS.find((d) => d.key === childDim)?.label}</th>
                        {stages.map((s) => <th key={s.goalId} className="text-right font-semibold">{s.goal?.name ?? DASH}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {breakdownRows.map((r) => {
                        const url = linkForChild(childDim, r.key);
                        return (
                          <tr key={r.key} className="hover:bg-accent-subtle/40">
                            <td >
                              {url ? <Link to={url} className="text-accent-text hover:underline">{r.name}</Link> : r.name}
                            </td>
                            {/* Columns follow the response's own stages, so cells always match the headers. */}
                            {stages.map((s) => (
                              <td key={s.goalId} className="px-4 py-3 text-right">{(r.counts[s.goalId] ?? 0).toLocaleString()}</td>
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
        </ReportBody>
      </ReportCard>

      {showApiRequest && <ApiRequestModal onClose={() => setShowApiRequest(false)} path={canRun ? `/api/reports/funnel?${funnelQs}` : '/api/reports/funnel'} appliedFilters={{
        offer: offerId ?? undefined, from: range.appliedFrom, to: range.appliedTo, child: childDim, events: selectedGoalIds.join(',') || undefined,
      }} />}
    </>
  );
}
