/**
 * Reporting › Saved & Scheduled › Requested Reports — report files built in the background
 * (POST /api/report-requests): an export someone asked for (a saved report over a range) or the whole
 * file of a scheduled report too big to email. The list refreshes while anything is still building; a
 * finished one downloads as CSV. Admins and managers see the network's (with who asked), everyone else
 * their own. Columns follow the reference: ID | Name | Report Type | Format | File | Error | Processed at
 * | Created (+ Range and, for admins / managers, Requested by).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { Field, Modal, Spinner, StateBlock } from '../../shared-components/primitives/ui';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { RANGE_OPTIONS } from '../../lib/reportSchedule';
import { SAVED_REPORT_SOURCES } from '../../lib/savedReportLink';
import { formatMdyDateTime } from '../../lib/datetime';
import { useReportZone } from '../../lib/useReportZone';
import type { SavedReportDto } from './ScheduleReportModal';

export interface ReportRequestDto {
  id: string; ref: number; name: string; page: string; format: 'csv'; source: 'manual' | 'scheduled';
  range: { from: string; to: string | null; label: string };
  status: 'queued' | 'processing' | 'done' | 'failed'; rows: number | null; totalRows: number | null; truncated: boolean;
  fileBytes: number | null; error: string | null; requestedBy: string; requestedByName: string | null;
  processedAt: string | null; createdAt: string;
}

const STATUS_LABEL: Record<ReportRequestDto['status'], string> = { queued: 'Queued', processing: 'Building…', done: 'Ready', failed: 'Failed' };
const fileSize = (n: number | null) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const fileName = (r: ReportRequestDto) => `${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report'}-${r.range.label.slice(0, 10)}.csv`;

/** "Request export…" on a saved report: its own saved dates, or a rolling range. */
export function RequestExportModal({ report, savedFrom, savedTo, onClose, onRequested }: {
  report: SavedReportDto; savedFrom?: string; savedTo?: string; onClose: () => void; onRequested: () => void;
}) {
  const [mode, setMode] = useState<'saved' | 'preset'>(savedFrom && savedTo ? 'saved' : 'preset');
  const [preset, setPreset] = useState('yesterday');
  const submit = useMutation((body: Record<string, unknown>) => api.post<ReportRequestDto>('/api/report-requests', body));
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body = mode === 'saved' ? { savedReportId: report.id, from: savedFrom, to: savedTo } : { savedReportId: report.id, rangePreset: preset };
    if (await submit.run(body)) { onRequested(); onClose(); }
  };
  return (
    <Modal open onClose={onClose} title={`Request export: ${report.name}`}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="request-export" className="btn-primary" disabled={submit.busy}>{submit.busy ? 'Requesting…' : 'Request export'}</button></>}>
      <form id="request-export" onSubmit={onSubmit} className="space-y-3">
        {submit.error && <p className="text-small text-danger-text">{submit.error}</p>}
        <p className="text-small text-fg-secondary">The whole report is built in the background — with the saved filters, metric filters, sort and hidden columns — and listed under Requested Reports for download (CSV, up to 100,000 rows). Dates are the network&rsquo;s time zone.</p>
        <Field label="Date range">
          <div className="space-y-2">
            {savedFrom && savedTo && (
              <label className="flex items-center gap-2 text-small"><input type="radio" checked={mode === 'saved'} onChange={() => setMode('saved')} /> Saved dates ({savedFrom} – {savedTo})</label>
            )}
            <label className="flex items-center gap-2 text-small"><input type="radio" checked={mode === 'preset'} onChange={() => setMode('preset')} /> Rolling range</label>
            {mode === 'preset' && (
              <select className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>
        </Field>
      </form>
    </Modal>
  );
}

export function RequestedReportsTab({ everyone, refreshKey }: { everyone: boolean; refreshKey: number }) {
  const zone = useReportZone();
  const confirm = useConfirm();
  const { data, loading, error, refetch } = useQuery<ReportRequestDto[]>(everyone ? '/api/report-requests?scope=network&limit=200' : '/api/report-requests?limit=200');
  const remove = useMutation((id: string) => api.del(`/api/report-requests/${id}`));
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const building = (data ?? []).some((r) => r.status === 'queued' || r.status === 'processing');
  // A new request from the Saved Reports tab shows at once; while something builds, poll for it.
  useEffect(() => { if (refreshKey) refetch(); }, [refreshKey, refetch]);
  useEffect(() => {
    if (!building) return undefined;
    const t = setInterval(refetch, 4000);
    return () => clearInterval(t);
  }, [building, refetch]);

  const download = async (r: ReportRequestDto) => {
    setDownloadError(null);
    try { await api.download(`/api/report-requests/${r.id}/download`, fileName(r)); } catch (e) { setDownloadError(e instanceof Error ? e.message : 'Download failed'); }
  };

  if (loading && !data) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;
  const rows = data ?? [];
  return (
    <div>
      {(downloadError || remove.error) && <p className="mb-3 text-small text-danger-text">{downloadError ?? remove.error}</p>}
      {!rows.length ? (
        <StateBlock>No requested reports yet — in Saved Reports, open a report&rsquo;s ⋮ menu and choose Request export…. Scheduled reports too big to email also land here.</StateBlock>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="premium-table">
            <thead>
              <tr>
                <th>ID</th><th>Name</th><th>Report Type</th><th>Range</th>{everyone && <th>Requested by</th>}<th>Format</th><th>File</th><th>Error</th>
                <th title={zone.tz}>Processed at</th><th title={zone.tz}>Created</th><th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-accent-subtle/40">
                  <td className="px-4 py-3 tabular-nums">{r.ref}</td>
                  <td className="px-4 py-3">{r.name}{r.source === 'scheduled' && <span className="ml-2 rounded-full bg-page px-2 py-0.5 text-tiny text-fg-secondary">Scheduled</span>}</td>
                  <td className="px-4 py-3">{SAVED_REPORT_SOURCES.find((s) => s.key === r.page)?.label ?? r.page}</td>
                  <td className="px-4 py-3 text-fg-secondary">{r.range.label}</td>
                  {everyone && <td className="px-4 py-3">{r.requestedByName ?? '—'}</td>}
                  <td className="px-4 py-3 uppercase">{r.format}</td>
                  <td className="px-4 py-3">
                    {r.status === 'done' ? (
                      <button type="button" className="inline-flex items-center gap-1 text-accent-text hover:underline" onClick={() => void download(r)}
                        title={r.truncated ? `The report has ${r.totalRows} rows — the file holds the first ${r.rows}` : undefined}>
                        <Download size={13} /> {r.rows} rows · {fileSize(r.fileBytes)}
                      </button>
                    ) : <span className={r.status === 'failed' ? 'text-danger-text' : 'text-fg-secondary'}>{STATUS_LABEL[r.status]}</span>}
                  </td>
                  <td className="px-4 py-3 text-small text-fg-secondary">{r.error ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{r.processedAt ? formatMdyDateTime(r.processedAt, zone.tz) : '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{formatMdyDateTime(r.createdAt, zone.tz)}</td>
                  <td className="text-right">
                    <button type="button" title="Delete" className="rounded p-1 text-fg-secondary hover:bg-danger-subtle hover:text-danger-text"
                      onClick={() => confirm({ title: 'Delete requested report?', message: `Delete "${r.name}" (${r.range.label}) and its file?`, confirmLabel: 'Delete', destructive: true,
                        onConfirm: async () => { if (await remove.run(r.id)) refetch(); } })}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-right text-tiny text-fg-muted">Files are kept for 30 days.</p>
    </div>
  );
}
