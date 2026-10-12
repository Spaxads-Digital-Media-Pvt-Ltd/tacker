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
import { Info } from 'lucide-react';
import { PageHeader } from '../../shared-components/primitives/ui';
import { daysAgo, todayStr } from '../../shared-components/primitives/ReportPageKit';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, DateRangeField, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';

const COLUMNS = ['Date', 'Offer', 'Partner', 'Country', 'Device', 'IP Address', 'Sub1', 'Sub2'] as const;

export default function ImpressionReport() {
  // No "Run Report": the range applies on its own like every other report (there's simply nothing
  // to fetch for it here — see above).
  const range = useAutoDateRange(daysAgo(7), todayStr());

  return (
    <>
      <PageHeader title="Impression Report" subtitle="Reporting › Impression" />

      <ReportCard>
        <ReportControls problem={range.problem}>
          <DateRangeField idPrefix="impression-report" from={range.from} to={range.to} max={todayStr()} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
        </ReportControls>

        {/* No search box: there are no rows to search (see above). */}
        <ResultsBar title="Detailed Report" />

        <ReportBody>
          <div className="mb-4 flex items-start gap-3">
            <Info size={16} className="mt-0.5 shrink-0 text-accent-text" />
            <p className="text-small text-fg-secondary">
              This network tracks clicks and conversions, not ad impressions. There's no impression
              pixel or impression-level data source in this app, so this report has no data to show —
              the same is true on Everflow's own live demo account for this report.
            </p>
          </div>
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="premium-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => <th key={c} >{c}</th>)}
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
        </ReportBody>
      </ReportCard>
    </>
  );
}
