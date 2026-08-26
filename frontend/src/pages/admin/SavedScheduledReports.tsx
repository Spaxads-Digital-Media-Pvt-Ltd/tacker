/**
 * Reporting › Saved & Scheduled — verified against the live reference (URL `/reporting/reports`,
 * three tabs: Saved Reports | Scheduled Reports | Requested Reports).
 *
 * Saved Reports is real, not a shell: every report page built this session with a page-kebab
 * "Save"/"Load" (Offer/Partner/Advertiser/Smart Link/Daily/Hourly Report) persists named configs to
 * localStorage via components/ReportPageKit.tsx's loadSavedReports/persistSavedReports, keyed per
 * report type. This page reads all of those keys and merges them into the one unified list the
 * reference shows — real names, real report types, real date ranges — with a working Delete.
 * "Open" navigates to that report's page, where its own Load menu (reading the same localStorage
 * key) can load the specific saved config; there's no cross-page deep-link for a specific saved
 * config today, so this doesn't pretend to auto-apply it on arrival.
 *
 * Scheduled Reports and Requested Reports are honest empty shells (components/EmptyShellTable.tsx,
 * the same pattern as PartnerReferralsReport.tsx/ProductsReport.tsx/RefundsReport.tsx) — this app
 * has no report-scheduling or async-export-request backend (no email delivery worker, no job queue
 * for "run this report and notify me when it's ready"), a finding already established earlier this
 * session when every report's page-kebab omitted "Schedule Report"/"Request Report" for the same
 * reason. Columns match the reference exactly: Scheduled = ID | Name | Report Type | Interval |
 * Frequency | Week Day | Day | Format. Requested = ID | Name | Report Type | Format | File | Error |
 * Processed at | Created.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Search } from 'lucide-react';
import { PageHeader, Tabs, StateBlock } from '../../components/ui';
import { EmptyShellTable } from '../../components/EmptyShellTable';
import { loadSavedReports, persistSavedReports, type SavedReportConfig } from '../../components/ReportPageKit';

const TABS = ['Saved Reports', 'Scheduled Reports', 'Requested Reports'] as const;

const REPORT_SOURCES: { key: string; label: string; route: string }[] = [
  { key: 'offer-report', label: 'Offer', route: '/app/reports/offer' },
  { key: 'partner-report', label: 'Partner', route: '/app/reports/partner' },
  { key: 'advertiser-report', label: 'Advertiser', route: '/app/reports/advertiser' },
  { key: 'smartlink-report', label: 'Smart Link', route: '/app/reports/smartlink' },
  { key: 'daily-report', label: 'Daily', route: '/app/reports/daily' },
  { key: 'hourly-report', label: 'Hourly', route: '/app/reports/hourly' },
];

interface SavedRow { source: string; label: string; route: string; name: string; from: string; to: string }

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function useSavedRows() {
  const [tick, setTick] = useState(0);
  const rows = useMemo<SavedRow[]>(() => {
    const out: SavedRow[] = [];
    for (const src of REPORT_SOURCES) {
      const saved = loadSavedReports<string>(src.key);
      for (const s of saved) out.push({ source: src.key, label: src.label, route: src.route, name: s.name, from: s.config.from, to: s.config.to });
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
          <table className="w-full text-left text-body">
            <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Name</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Report Type</th>
                <th className="whitespace-nowrap px-4 py-3 font-semibold">Interval</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={`${r.source}-${r.name}`} className="hover:bg-accent-subtle/40">
                  <td className="px-4 py-3">
                    <button type="button" className="font-medium text-accent-text hover:underline" onClick={() => nav(r.route)}>{r.name}</button>
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
                        <button onClick={() => { setMenuFor(null); nav(r.route); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Open</button>
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
          <p className="text-small text-fg-muted">Scheduled Reports aren't available yet — this network has no report-scheduling or email-delivery worker configured.</p>
          <EmptyShellTable columns={SCHEDULED_COLUMNS} search={false} />
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
