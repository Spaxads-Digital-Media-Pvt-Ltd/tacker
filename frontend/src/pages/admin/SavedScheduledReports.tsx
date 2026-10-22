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
 * Scheduled Reports lists the saved reports that have a schedule (F-24) — the whole network's, with
 * each owner, for admins and managers; everyone else's own (D4: every role schedules its own) — and
 * the scheduled-reports worker emails them as CSV. "Schedule…" on a saved report (or "Edit schedule"
 * here) opens ScheduleReportModal — daily / weekly / monthly at a time, or a cron, in the network's
 * time zone, plus recipients (Finance / Read-only: their own email) and a rolling date range; also
 * Send now and Remove schedule.
 * Requested Reports (RequestedReports.tsx) lists report files built in the background: "Request export…"
 * on a saved report (its saved dates or a rolling range), and scheduled reports too big to email.
 * Columns match the reference: Scheduled = ID | Name | Report Type | Interval | Frequency | Week Day |
 * Day | Format. Requested = ID | Name | Report Type | Format | File | Error | Processed at | Created.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Search } from 'lucide-react';
import { PageHeader, Tabs, StateBlock, Spinner } from '../../shared-components/primitives/ui';
import { loadSavedReports, persistSavedReports, syncSavedReports } from '../../lib/savedReports';
import type { SavedReportConfig } from '../../shared-components/primitives/ReportPageKit';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { describeSchedule, rangeLabel, sendSummary, type SendResult } from '../../lib/reportSchedule';
import { SAVED_REPORT_SOURCES, savedReportHref, type SavedReportLinkConfig } from '../../lib/savedReportLink';
import { ScheduleReportModal, type SavedReportDto } from './ScheduleReportModal';
import { RequestExportModal, RequestedReportsTab } from './RequestedReports';

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
  return { rows, remove, tick };
}

function SavedReportsTab({ onExportRequested }: { onExportRequested: () => void }) {
  const nav = useNavigate();
  const { rows, remove, tick } = useSavedRows();
  const [exporting, setExporting] = useState<{ report: SavedReportDto; from: string; to: string } | null>(null);
  const [q, setQ] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<SavedReportDto | null>(null);
  // The caller's saved reports on the server (ids + schedules); re-read once the sync above lands.
  const server = useQuery<SavedReportDto[]>('/api/saved-reports');
  const refetchServer = server.refetch;
  useEffect(() => { if (tick) refetchServer(); }, [tick, refetchServer]);
  const onServer = (r: SavedRow) => (server.data ?? []).find((s) => s.page === r.source && s.name === r.name) ?? null;

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
                    {onServer(r)?.schedule && <span className="ml-2 rounded-full bg-accent-subtle px-2 py-0.5 text-tiny font-medium text-accent-text" title={describeSchedule(onServer(r)?.schedule).frequency}>Scheduled</span>}
                  </td>
                  <td className="px-4 py-3">{r.label}</td>
                  <td className="px-4 py-3 text-fg-secondary">{formatDate(r.from)} – {formatDate(r.to)}</td>
                  <td className="relative text-right">
                    <button type="button" title="Actions" onClick={() => setMenuFor(menuFor === `${r.source}-${r.name}` ? null : `${r.source}-${r.name}`)}
                      className="grid h-8 w-8 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
                      <MoreVertical size={15} />
                    </button>
                    {menuFor === `${r.source}-${r.name}` && (
                      <div className="absolute right-2 top-full z-30 w-44 rounded-card border border-border bg-elevated py-1 shadow-elevated" onMouseLeave={() => setMenuFor(null)}>
                        <button onClick={() => { setMenuFor(null); nav(r.href); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Open</button>
                        <button onClick={() => { const s = onServer(r); setMenuFor(null); if (s) setScheduling(s); }} disabled={!onServer(r)}
                          title={onServer(r) ? undefined : 'Still saving to the server — try again in a moment'}
                          className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:opacity-50">{onServer(r)?.schedule ? 'Edit schedule…' : 'Schedule…'}</button>
                        <button onClick={() => { const s = onServer(r); setMenuFor(null); if (s) setExporting({ report: s, from: r.from, to: r.to }); }} disabled={!onServer(r)}
                          title={onServer(r) ? 'Build the whole report as a CSV file (Requested Reports)' : 'Still saving to the server — try again in a moment'}
                          className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle disabled:opacity-50">Request export…</button>
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
      {scheduling && <ScheduleReportModal report={scheduling} onClose={() => setScheduling(null)} onChanged={refetchServer} />}
      {exporting && <RequestExportModal report={exporting.report} savedFrom={exporting.from} savedTo={exporting.to} onClose={() => setExporting(null)} onRequested={onExportRequested} />}
    </div>
  );
}

const SCHEDULED_COLUMNS = ['ID', 'Name', 'Report Type', 'Interval', 'Frequency', 'Week Day', 'Day', 'Format', 'Last Run'];

/** Admins / managers: every scheduled report in the network, with its owner (they manage them all).
 *  Everyone else: their own. */
function ScheduledReportsTab() {
  const nav = useNavigate();
  const me = useQuery<{ identity?: { role?: string } }>('/api/me');
  const everyone = ['admin', 'manager'].includes(me.data?.identity?.role ?? '');
  const list = useQuery<SavedReportDto[]>(me.loading ? null : everyone ? '/api/saved-reports?scope=network' : '/api/saved-reports');
  const { data, error, refetch } = list;
  const loading = me.loading || list.loading;
  const columns = everyone ? [...SCHEDULED_COLUMNS.slice(0, 2), 'Owner', ...SCHEDULED_COLUMNS.slice(2)] : SCHEDULED_COLUMNS;
  const [editing, setEditing] = useState<SavedReportDto | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const send = useMutation((id: string) => api.post<SendResult>(`/api/saved-reports/${id}/send`, {}));
  const unschedule = useMutation((id: string) => api.patch(`/api/saved-reports/${id}`, { schedule: null }));
  const rows = (data ?? []).filter((r) => r.schedule);

  const act = async (what: 'send' | 'remove', r: SavedReportDto) => {
    setMenuFor(null);
    setNotice(null);
    if (what === 'send') {
      const res = await send.run(r.id);
      if (res) setNotice(`${r.name}: ${sendSummary(res)}`);
    } else if (await unschedule.run(r.id)) {
      setNotice(`${r.name}: schedule removed (the saved report is kept).`);
    }
    refetch();
  };

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;
  return (
    <div>
      {(send.error || unschedule.error) && <p className="mb-3 text-small text-danger-text">{send.error ?? unschedule.error}</p>}
      {notice && <p className="mb-3 rounded-[var(--radius)] bg-page px-3 py-2 text-small text-fg">{notice}</p>}
      {!rows.length ? (
        <StateBlock>No scheduled reports yet — in Saved Reports, open a report’s ⋮ menu and choose Schedule…</StateBlock>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="premium-table">
            <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}<th className="w-9" /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const src = SAVED_REPORT_SOURCES.find((s) => s.key === r.page);
                const d = describeSchedule(r.schedule);
                return (
                  <tr key={r.id} className="hover:bg-accent-subtle/40">
                    <td className="px-4 py-3 font-mono text-tiny">{r.id.slice(0, 8)}</td>
                    <td className="px-4 py-3">
                      <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => setEditing(r)}>{r.name}</button>
                    </td>
                    {everyone && (
                      <td className="px-4 py-3" title={r.owner?.disabled ? 'Account disabled — this report isn’t sent' : r.owner?.email ?? undefined}>
                        <span className={r.owner?.disabled ? 'text-fg-muted line-through' : undefined}>{r.owner?.name || r.owner?.email || '—'}</span>
                      </td>
                    )}
                    <td className="px-4 py-3">{src?.label ?? r.page}</td>
                    <td className="px-4 py-3">{rangeLabel(r.rangePreset)}</td>
                    <td className="px-4 py-3">{d.frequency}</td>
                    <td className="px-4 py-3">{d.weekday}</td>
                    <td className="px-4 py-3">{d.day}</td>
                    <td className="px-4 py-3">CSV (email)</td>
                    <td className="px-4 py-3" title={r.lastRunDetail ?? undefined}>
                      <span className={r.lastRunStatus && r.lastRunStatus !== 'sent' ? 'text-danger-text' : undefined}>{r.lastRunStatus ?? 'Not yet'}</span>
                    </td>
                    <td className="relative text-right">
                      <button type="button" title="Actions" onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}
                        className="grid h-8 w-8 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg">
                        <MoreVertical size={15} />
                      </button>
                      {menuFor === r.id && (
                        <div className="absolute right-2 top-full z-30 w-40 rounded-card border border-border bg-elevated py-1 shadow-elevated" onMouseLeave={() => setMenuFor(null)}>
                          <button onClick={() => { setMenuFor(null); setEditing(r); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Edit schedule…</button>
                          <button onClick={() => void act('send', r)} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Send now</button>
                          {src && <button onClick={() => { setMenuFor(null); nav(savedReportHref(src, r.config as SavedReportLinkConfig)); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Open report</button>}
                          <button onClick={() => void act('remove', r)} className="block w-full px-3 py-1.5 text-left text-small text-danger-text hover:bg-accent-subtle">Remove schedule</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ScheduleReportModal report={editing} onClose={() => setEditing(null)} onChanged={refetch} />}
    </div>
  );
}
export default function SavedScheduledReports() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Saved Reports');
  const [requested, setRequested] = useState(0);
  const me = useQuery<{ identity?: { role?: string } }>('/api/me');
  const everyone = ['admin', 'manager'].includes(me.data?.identity?.role ?? '');

  return (
    <>
      <PageHeader title="Saved & Scheduled" subtitle="Reporting › Saved & Scheduled" />
      <Tabs tabs={[...TABS]} active={tab} onChange={(t) => setTab(t as (typeof TABS)[number])} />

      {tab === 'Saved Reports' && <SavedReportsTab onExportRequested={() => { setRequested((n) => n + 1); setTab('Requested Reports'); }} />}
      {tab === 'Scheduled Reports' && (
        <div className="space-y-3">
          <p className="text-small text-fg-muted">Scheduled reports are emailed as CSV on their schedule. To add one, open a saved report’s ⋮ menu (Saved Reports tab) and choose “Schedule…”.</p>
          <ScheduledReportsTab />
        </div>
      )}
      {tab === 'Requested Reports' && !me.loading && (
        <div className="space-y-3">
          <p className="text-small text-fg-muted">Report files built in the background — exports you request from a saved report’s ⋮ menu, and scheduled reports too big to email. Download a finished one as CSV.</p>
          <RequestedReportsTab everyone={everyone} refreshKey={requested} />
        </div>
      )}
    </>
  );
}
