/**
 * Change-history for one record — the shared version of the per-page "… History" modals and tabs
 * (advertisers, coupons, link templates, offer groups, invoices …), which all read the same
 * `GET …/:id/history` shape. The endpoint is a prop; the columns default to the shared six and can be
 * replaced (`columns`) where a page shows a different set.
 *
 * Times: the page-local copies rendered `new Date(t).toLocaleString()` — the viewer's BROWSER zone.
 * This keeps that zone (overridable with `timeZone`), in the app's unambiguous `YYYY-MM-DD HH:mm:ss`,
 * with the relative age on hover. Loading / empty / error (with retry) use StateBlock's variants.
 *
 * `HistoryModal` (dialog) is used by Advertisers, Advertiser Invoices, Coupon Codes, Link Templates,
 * Offer Traffic Controls, Partner Invoices, Postback Controls, Postbacks and Tiered Commissions;
 * `HistoryList` (the same list, inline) by the History tabs of Offer Groups, Smart Links and Partner
 * Tiers. The page-local copies are gone.
 */
import { Modal, StateBlock, Table, type Column } from '../primitives/ui';
import { useQuery } from '../../lib/useApi';
import { browserTimeZone, formatDateTime, timeAgo } from '../../lib/datetime';

/** The shared `…/:id/history` row. */
interface HistoryRow {
  id: string;
  operationTime: string;
  service?: string;
  changes: string;
  employee: string | null;
  method: string;
  portal: string;
  userIp: string | null;
}

/** The history list on its own — what a History *tab* renders inline, and the body of HistoryModal. */
export function HistoryList<Row extends { id: string } = HistoryRow>({ endpoint, timeZone, columns, caption, zoneNote = false }: {
  /** The record's history endpoint, e.g. `/api/offer-groups/${id}/history`. */
  endpoint: string;
  /** IANA zone for the timestamps; defaults to the viewer's browser zone (what the pages use today). */
  timeZone?: string;
  /** Replaces the default six columns (for a history whose rows differ). */
  columns?: Column<Row>[];
  /** Accessible name for the table (visually hidden). */
  caption: string;
  /** Show "Times in <zone>." above the table (inline use; the dialog says it in its description). */
  zoneNote?: boolean;
}) {
  const { data, loading, error, refetch } = useQuery<Row[]>(endpoint);
  const tz = timeZone ?? browserTimeZone();
  const defaultColumns: Column<HistoryRow>[] = [
    {
      header: 'Operation Time',
      cell: (r) => <span className="tabular-nums" title={timeAgo(r.operationTime)}>{formatDateTime(r.operationTime, tz)}</span>,
    },
    { header: 'Changes', cell: (r) => <span className="whitespace-normal">{r.changes}</span>, className: 'min-w-[16rem]' },
    { header: 'Employee', cell: (r) => r.employee ?? 'System' },
    { header: 'Method', cell: (r) => r.method },
    { header: 'Portal', cell: (r) => r.portal },
    { header: 'User IP', cell: (r) => <span className="font-mono text-tiny">{r.userIp ?? '—'}</span> },
  ];

  if (loading && !data) return <StateBlock variant="loading" title="Loading history…" rows={5} />;
  if (error) return <StateBlock variant="error" title="Couldn’t load the history" hint={error} onRetry={refetch} />;
  if (!data || data.length === 0) return <StateBlock variant="empty" title="No changes recorded yet" hint="Edits to this record will be listed here." />;
  return (
    <>
      {zoneNote && <p className="mb-3 text-tiny text-fg-muted">Times in {tz}.</p>}
      <Table columns={columns ?? (defaultColumns as unknown as Column<Row>[])} rows={data} rowKey={(r) => r.id} stickyCol={-1} caption={caption} />
    </>
  );
}

export function HistoryModal<Row extends { id: string } = HistoryRow>({ title, endpoint, onClose, timeZone, columns }: {
  /** Dialog title, e.g. "Advertiser History". */
  title: string;
  /** The record's history endpoint, e.g. `/api/advertisers/${id}/history`. */
  endpoint: string;
  onClose: () => void;
  /** IANA zone for the timestamps; defaults to the viewer's browser zone (what the pages use today). */
  timeZone?: string;
  /** Replaces the default six columns (for a history whose rows differ). */
  columns?: Column<Row>[];
}) {
  const tz = timeZone ?? browserTimeZone();
  return (
    <Modal open onClose={onClose} title={title} size="xl" description={`Times in ${tz}.`}>
      <HistoryList<Row> endpoint={endpoint} timeZone={tz} columns={columns} caption={title} />
    </Modal>
  );
}
