/**
 * Reporting › Impression — the row-level impression log (one row per impression from the impression pixel,
 * `GET /api/reports/impressions`), accepted and rejected alike: a rejected impression's first flag is the reason,
 * the same reasons as a rejected click. Impressions bill CPM offers and feed view-through attribution
 * (backend tracking/impression.ts). Totals per offer / partner are the opt-in `impressions` metrics of
 * `/api/reports` (Offer, Partner, Daily reports).
 */
import { useMemo } from 'react';
import { PageHeader, Spinner } from '../../shared-components/primitives/ui';
import { useAutoDateRange } from './reportView';
import { ReportCard, ReportControls, DateRangeField, ResultsBar, ReportBody } from '../../shared-components/primitives/ReportLayout';
import { DASH, deviceLabel } from '../../shared-components/primitives/ReportPageKit';
import { useReportZone } from '../../lib/useReportZone';
import { useQuery } from '../../lib/useApi';
import { formatDateTime } from '../../lib/datetime';
import { clickRejection } from '../../lib/clickReportFilters';
import { countryLabel } from '../../data/geo';
import type { Offer, Publisher } from '../../types';

interface ImpressionRow {
  impression_id: string; created_at: string; offer_id: string; publisher_id: string | null; ip: string | null;
  country: string | null; device: string | null; sub1: string | null; creative_id: string | null;
  is_unique: boolean; fraud_flags: string[];
}

const PAGE = 100;
const COLUMNS = ['Date', 'Offer', 'Partner', 'Country', 'Device', 'IP Address', 'Sub1', 'Creative', 'Status'] as const;

/** Valid, flagged (counted, not billed), or rejected with its reason. */
function statusOf(r: ImpressionRow): string {
  const rejected = clickRejection(r.fraud_flags);
  if (rejected) return `Rejected — ${rejected}`;
  if (r.fraud_flags.length) return `Flagged — ${r.fraud_flags.join(', ')}`;
  return r.is_unique ? 'Valid · unique' : 'Valid';
}

export default function ImpressionReport() {
  // D7: the report's time zone — the network's unless one is picked beside the dates.
  const zone = useReportZone();
  const range = useAutoDateRange(zone.daysAgo(7), zone.today());
  const params = new URLSearchParams({ ...zone.range(range.appliedFrom, range.appliedTo), limit: String(PAGE), offset: String((range.page - 1) * PAGE) });
  const { data: rows, loading: isLoading, error } = useQuery<ImpressionRow[]>(`/api/reports/impressions?${params.toString()}`);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const offerName = useMemo(() => new Map((offers ?? []).map((o) => [o.id, o.name])), [offers]);
  const partnerName = useMemo(() => new Map((publishers ?? []).map((p) => [p.id, p.name])), [publishers]);
  const list = error ? [] : rows ?? [];

  return (
    <>
      <PageHeader title="Impression Report" subtitle="Reporting › Impression" />

      <ReportCard>
        <ReportControls problem={range.problem}>
          <DateRangeField idPrefix="impression-report" from={range.from} to={range.to} max={zone.today()} zone={zone} invalid={range.problem !== null}
            onFrom={range.setFrom} onTo={range.setTo} />
        </ReportControls>

        <ResultsBar title="Detailed Report" loading={isLoading} />

        <ReportBody>
          {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="premium-table">
              <thead>
                <tr>{COLUMNS.map((c) => <th key={c} title={c === 'Date' ? zone.tz : undefined}>{c}{c === 'Date' ? ` (${zone.label})` : ''}</th>)}</tr>
              </thead>
              <tbody>
                {isLoading && !rows ? (
                  <tr><td colSpan={COLUMNS.length} className="px-4 py-10 text-center"><Spinner /></td></tr>
                ) : list.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-small text-fg-muted">No Record Found</td></tr>
                ) : list.map((r) => (
                  <tr key={r.impression_id}>
                    <td className="whitespace-nowrap">{formatDateTime(r.created_at, zone.tz)}</td>
                    <td>{offerName.get(r.offer_id) ?? r.offer_id.slice(0, 8)}</td>
                    <td>{r.publisher_id ? partnerName.get(r.publisher_id) ?? r.publisher_id.slice(0, 8) : DASH}</td>
                    <td>{r.country ? countryLabel(r.country) : DASH}</td>
                    <td>{r.device ? deviceLabel(r.device) : DASH}</td>
                    <td className="font-mono text-tiny">{r.ip ?? DASH}</td>
                    <td>{r.sub1 ?? DASH}</td>
                    <td>{r.creative_id ?? DASH}</td>
                    <td>{statusOf(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-end gap-3 text-tiny text-fg-secondary">
            <span>Page {range.page}</span>
            <button type="button" className="btn-ghost" disabled={range.page <= 1} onClick={() => range.setPage(range.page - 1)}>Previous</button>
            <button type="button" className="btn-ghost" disabled={list.length < PAGE} onClick={() => range.setPage(range.page + 1)}>Next</button>
          </div>
        </ReportBody>
      </ReportCard>
    </>
  );
}
