/**
 * Reporting › Impression — verified against the live reference. Unlike every other report page
 * (Offer/Partner/Advertiser/Smart Link/Daily/Hourly), Impression Report is a raw event-log page —
 * one row per ad impression, not a grouped aggregate — with ~40 columns of mostly device/fraud
 * metadata (IDFA, Google Ad ID, ISP, City, Browser, etc.).
 *
 * This app has no impression-tracking data model at all: only `clicks` and `conversions` are
 * recorded (confirmed via grep — the only trace of "impressions" anywhere in the backend is an
 * offer objective enum value and an explicitly always-zero override field). There is no impression
 * pixel, no impressions table, nothing to aggregate or list.
 *
 * Verified live against the reference itself (proper "Last 7 Days" range + an actual Run Report
 * click, not just the default same-day view): even Everflow's own demo account shows "No Record
 * Found / 0 Total" for this report — it has no real impression data either. So a page that always
 * renders empty isn't a gap unique to this app; it's page shell + an honest explanation of why,
 * rather than 40 fabricated columns that could never hold real values here.
 */
import { useState } from 'react';
import { Search, MoreVertical, Info } from 'lucide-react';
import { PageHeader, StateBlock } from '../../components/ui';
import { daysAgo, todayStr } from '../../components/ReportPageKit';

const COLUMNS = ['Date', 'Offer', 'Partner', 'Country', 'Device', 'IP Address', 'Sub1', 'Sub2'] as const;

export default function ImpressionReport() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayStr());
  const [hasRun, setHasRun] = useState(true);
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    await navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <PageHeader title="Impression Report" subtitle="Reporting › Impression" action={
        <button type="button" onClick={copyLink} title="Page Actions"
          className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
          <MoreVertical size={15} />
        </button>
      } />
      {copied && <p className="mb-3 text-tiny text-fg-secondary">Link copied.</p>}

      <div className="card mb-4">
        <div className="flex items-start gap-3">
          <Info size={16} className="mt-0.5 shrink-0 text-accent-text" />
          <p className="text-small text-fg-secondary">
            This network tracks clicks and conversions, not ad impressions. There's no impression
            pixel or impression-level data source in this app, so this report has no data to show —
            the same is true on Everflow's own live demo account for this report.
          </p>
        </div>
      </div>

      <div className="card mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label mb-1 block">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setHasRun(false); }} />
          </div>
          <div>
            <label className="label mb-1 block">To</label>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => { setTo(e.target.value); setHasRun(false); }} />
          </div>
          <div className="flex-1" />
          <button type="button" className="btn-primary" onClick={() => setHasRun(true)}>Run Report</button>
        </div>
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-h3 font-medium text-fg">Detailed Report</h3>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input className="input !w-56 !pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {!hasRun ? <StateBlock>Set parameters and run report</StateBlock> : (
          <>
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[900px] text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    {COLUMNS.map((c) => <th key={c} className="whitespace-nowrap px-4 py-3 font-semibold">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-small text-fg-muted">No Record Found</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end text-tiny text-fg-secondary">0 Total</div>
          </>
        )}
      </div>
    </>
  );
}
