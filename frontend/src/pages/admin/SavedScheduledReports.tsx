/**
 * Reporting › Saved & Scheduled — verified against the live reference (URL `/reporting/reports`,
 * three tabs: Saved Reports | Scheduled Reports | Requested Reports).
 *
 * Saved Reports is real, not a shell: every report page with a page-kebab "Save"/"Load"
 * (Offer/Partner/Advertiser/Smart Link/Daily/Hourly Report) saves named configs to the server
 * (/api/saved-reports, F-24) with a per-user localStorage cache per report type (lib/savedReports.ts's
 * loadSavedReports/persistSavedReports). This page loads them from the server and merges them into
 * the one unified list the reference shows — real names, report types, date ranges — with Delete.
 * Flex and Nested (Analytics) saved reports are listed too. "Open" reopens the report WITH the saved
 * config, as URL params the target page reads on load (lib/savedReportLink.ts) — dates, filters,
 * exclusions, metric filters, Ignore Fail Traffic, sort, plus Flex dimensions / Nested parent+child.
 * Hidden columns aren't URL state on those pages, so they're only applied via the page's own Load menu.
 *
 * Scheduled Reports lists the saved reports that have a schedule (F-24): the scheduled-reports worker
 * emails them as CSV; a schedule (5-field cron in the network's time zone + recipients + a rolling
 * range) is set through the API — PATCH /api/saved-reports/:id — as there is no schedule form yet.
 * Requested Reports is an honest empty shell (no async export-request queue). Columns match the
 * reference: Scheduled = ID | Name | Report Type | Interval | Frequency | Week Day | Day | Format.
 * Requested = ID | Name | Report Type | Format | File | Error | Processed at | Created.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Search } from 'lucide-react';
import { PageHeader, Tabs, StateBlock } from '../../shared-components/primitives/ui';
import { EmptyShellTable } from '../../shared-components/primitives/EmptyShellTable';
import { loadSavedReports, persistSavedReports, syncSavedReports } from '../../lib/savedReports';
import type { SavedReportConfig } from '../../shared-components/primitives/ReportPageKit';
import { useQuery } from '../../lib/useApi';
import type { ShellRow } from '../../shared-components/primitives/EmptyShellTable';
import { SAVED_REPORT_SOURCES, savedReportHref } from '../../lib/savedReportLink';

const TABS = ['Saved Reports', 'Scheduled Reports', 'Requested Reports'] as const;

/** `href` reopens the report with the saved config applied. */
interface SavedRow { source: string; label: string; href: string; name: string; from: string; to: string }

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function useSavedRows() {
  const [tick, setTick] = useState(0);
  // The server is the source of truth: refresh every report type's cache from it once on load.
  useEffect(() => {
    let live = true;
    void syncSavedReports(SAVED_REPORT_SOURCES.map((src) => src.key)).then(() => {
      if (live) setTick((t) => t + 1);
    }).catch(() => { /* keep the cache */ });
    return () => { live = false; };
  }, []);
  const rows = useMemo<SavedRow[]>(() => {
    const out: SavedRow[] = [];
    for (const src of SAVED_REPORT_SOURCES) {
      const saved = loadSavedReports<string>(src.key);
      for (const s of saved) out.push({ source: src.key, label: src.label, href: savedReportHref(src, s.config), name: s.name, from: s.config.from, to: s.config.to });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  const remove = (source: string, name: string) => {
    const remaining = loadSavedReports<string>(source).filter((s) => s.name !== name);
    persistSavedReports(source, remaining as { name: string; config: SavedReportConfig<string> }[]);
    setTick((t) => t + 1);
  };
  return { rows, remove };
}

function SavedReportsTab() {
  const nav = useNavigate();
  const { rows, remove } = useSavedRows();
  const [q, setQ] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const filtered = rows.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      <div className="mb-3 flex items-center justify-end">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {!filtered.length ? (
        <StateBlock>{q.trim() ? 'No Record Found' : 'No saved reports yet — open any report and use its page menu to Save one.'}</StateBlock>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="premium-table">
            <thead>
              <tr>
                <th >Name</th>
                <th >Report Type</th>
                <th >Interval</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.source}-${r.name}`} className="hover:bg-accent-subtle/40">
                  <td className="px-4 py-3">
                    <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => nav(r.href)}>{r.name}</button>
                  </td>
                  <td className="px-4 py-3">{r.label}</td>
                  <td className="px-4 py-3 text-fg-secondary">{formatDate(r.from)} – {formatDate(r.to)}</td>
                  <td className="relative text-right">
                    <button type="button" title="Actions" onClick={() => setMenuFor(menuFor === `${r.source}-${r.name}` ? null : `${r.source}-${r.name}`)}
                      className="grid h-8 w-8 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
                      <MoreVertical size={15} />
                    </button>
                    {menuFor === `${r.source}-${r.name}` && (
                      <div className="absolute right-2 top-full z-30 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated" onMouseLeave={() => setMenuFor(null)}>
                        <button onClick={() => { setMenuFor(null); nav(r.href); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Open</button>
                        <button onClick={() => { setMenuFor(null); remove(r.source, r.name); }} className="block w-full px-3 py-1.5 text-left text-small text-danger-text hover:bg-accent-subtle">Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-2 text-tiny text-fg-muted">
        <span>{filtered.length} Total</span>
      </div>
    </div>
  );
}

const SCHEDULED_COLUMNS = ['ID', 'Name', 'Report Type', 'Interval', 'Frequency', 'Week Day', 'Day', 'Format'];
const RANGE_LABEL: Record<string, string> = {
  yesterday: 'Yesterday', last_7_days: 'Last 7 days', last_30_days: 'Last 30 days', month_to_date: 'Month to date', last_month: 'Last month',
};
interface ServerSaved { id: string; page: string; name: string; schedule: string | null; rangePreset: string }

function ScheduledReportsTab() {
  const { data, loading, error } = useQuery<ServerSaved[]>('/api/saved-reports?scope=network'); // every scheduled report in the network, not just mine
  const rows: ShellRow[] = (data ?? []).filter((r) => r.schedule).map((r) => ({
    id: r.id,
    cells: {
      ID: r.id.slice(0, 8), Name: r.name, 'Report Type': SAVED_REPORT_SOURCES.find((s) => s.key === r.page)?.label ?? r.page,
      Interval: RANGE_LABEL[r.rangePreset] ?? r.rangePreset, Frequency: r.schedule ?? '—', 'Week Day': '—', Day: '—', Format: 'CSV (email)',
    },
  }));
  return <EmptyShellTable columns={SCHEDULED_COLUMNS} search={false} rows={rows} loading={loading} error={error} />;
}
const REQUESTED_COLUMNS = ['ID', 'Name', 'Report Type', 'Format', 'File', 'Error', 'Processed at', 'Created'];

export default function SavedScheduledReports() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Saved Reports');

  return (
    <>
      <PageHeader title="Saved & Scheduled" subtitle="Reporting › Saved & Scheduled" />
      <Tabs tabs={[...TABS]} active={tab} onChange={(t) => setTab(t as (typeof TABS)[number])} />

      {tab === 'Saved Reports' && <SavedReportsTab />}
      {tab === 'Scheduled Reports' && (
        <div className="space-y-3">
          <p className="text-small text-fg-muted">Scheduled reports are emailed as CSV on their schedule. A schedule is set through the API for now (PATCH /api/saved-reports/:id).</p>
          <ScheduledReportsTab />
        </div>
      )}
      {tab === 'Requested Reports' && (
        <div className="space-y-3">
          <p className="text-small text-fg-muted">Requested Reports aren't available yet — this network has no async report-export job queue configured.</p>
          <EmptyShellTable columns={REQUESTED_COLUMNS} search={false} />
        </div>
      )}
    </>
  );
}
