/**
 * Reporting › Conversion Imports — verified against the live reference ("Manage Conversion
 * Imports", URL `/reporting/imports`, real job history: ID | Type | Total Rows | Total Processed |
 * Progress | Conversion Errors | Import Date | Processed Date | Created By, types seen included
 * "Update Revenue/Payout By Transaction ID" and "Clickless").
 *
 * This is a genuinely different feature from the existing single-record "Record offline conversion"
 * flow (AddConversion.tsx) — the reference page is a log of *bulk CSV import jobs*, which this app
 * had no path for at all before this page. Real backend added: `POST /api/conversion-imports`
 * (api-backend/src/surfaces/dashboard/conversion-imports/routes.ts) processes each parsed CSV row
 * individually against the real conversions table — a bad row doesn't fail the whole job — and logs
 * one job row to the existing import_export_logs table (extended with total_processed/error_count/
 * errors/processed_at). CSV is parsed client-side (no upload/streaming — pasted or a small file read
 * into a textarea) since this app has no async job worker for large files.
 *
 * Three real import types, matching what this schema can actually do (the reference's "Clickless"
 * type — creating a conversion with no originating click — maps directly onto this app's existing
 * source='manual' offline-conversion path, so it's included as "Create Offline Conversions"):
 *   - Create Offline Conversions (offerRef, event, payout, revenue, transactionId, publisherRef?)
 *   - Update Revenue/Payout By Transaction ID (transactionId, payout?, revenue?)
 *   - Update Revenue/Payout By Conversion ID (conversionId, payout?, revenue?)
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock, Modal } from '../../components/ui';

type ImportType = 'create' | 'update_by_transaction_id' | 'update_by_conversion_id';
const TYPE_OPTIONS: { value: ImportType; label: string; columns: string }[] = [
  { value: 'create', label: 'Create Offline Conversions', columns: 'offerRef, event, payout, revenue, transactionId, publisherRef (optional)' },
  { value: 'update_by_transaction_id', label: 'Update Revenue/Payout By Transaction ID', columns: 'transactionId, payout (optional), revenue (optional)' },
  { value: 'update_by_conversion_id', label: 'Update Revenue/Payout By Conversion ID', columns: 'conversionId, payout (optional), revenue (optional)' },
];

interface ImportJob {
  id: string; detail: string; row_count: number; total_processed: number | null;
  error_count: number; errors: { row: number; message: string }[];
  created_at: string; processed_at: string | null; created_by_name: string | null; created_by_email: string | null;
}

/** Minimal CSV parser — header row + comma-separated values, double-quote escaping for commas. No
 * external dependency; this app has no other CSV *parsing* need (only export), so a small
 * purpose-built parser is simpler than adding a library for one screen. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const splitLine = (line: string): string[] => {
    const out: string[] = []; let cur = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === ',' && !inQuotes) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = splitLine(lines[0]!);
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { if (cells[i]) row[h] = cells[i]!; });
    return row;
  });
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<ImportType>('update_by_transaction_id');
  const [csvText, setCsvText] = useState('');
  const [result, setResult] = useState<ImportJob | null>(null);
  const run = useMutation((body: Record<string, unknown>) => api.post<ImportJob>('/api/conversion-imports', body));

  const rows = parseCsv(csvText);
  const typeInfo = TYPE_OPTIONS.find((t) => t.value === type)!;

  const submit = async () => {
    if (!rows.length) return;
    const res = await run.run({ type, rows });
    if (res) { setResult(res); onDone(); }
  };

  if (result) {
    return (
      <Modal open onClose={onClose} title="Import Complete">
        <div className="space-y-3">
          <p className="text-small text-fg">
            <span className="font-semibold text-fg">{result.total_processed ?? 0}</span> of <span className="font-semibold text-fg">{result.row_count}</span> rows processed.
            {result.error_count > 0 && <span className="text-danger-text"> {result.error_count} error{result.error_count === 1 ? '' : 's'}.</span>}
          </p>
          {result.errors.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-[var(--radius)] border border-border">
              {result.errors.map((e, i) => (
                <div key={i} className="border-b border-border px-3 py-1.5 text-tiny last:border-b-0">
                  <span className="font-mono text-fg-secondary">Row {e.row}:</span> <span className="text-danger-text">{e.message}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end pt-2">
            <button type="button" className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Import Conversions" size="xl">
      <div className="space-y-4">
        <div>
          <label className="label mb-1 block">Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ImportType)}>
            {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <p className="mt-1 text-tiny text-fg-muted">Expected columns: <span className="font-mono">{typeInfo.columns}</span></p>
        </div>
        <div>
          <label className="label mb-1 block">CSV (with header row)</label>
          <textarea className="input h-40 resize-y font-mono text-tiny" value={csvText} onChange={(e) => setCsvText(e.target.value)}
            placeholder={type === 'create' ? 'offerRef,event,payout,revenue,transactionId\n2,sale,5.00,10.00,txn-001' : 'transactionId,payout,revenue\ntxn-001,5.00,10.00'} />
          <p className="mt-1 text-tiny text-fg-muted">{rows.length > 0 ? `${rows.length} row${rows.length === 1 ? '' : 's'} parsed.` : 'Paste CSV text above, including a header row.'}</p>
        </div>
        {run.error && <p className="text-small text-danger-text">{run.error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={run.busy || !rows.length} onClick={submit}>
            {run.busy ? 'Importing…' : `Import ${rows.length || ''} Row${rows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function ConversionImportsManage() {
  const { data, loading, error, refetch } = useQuery<ImportJob[]>('/api/conversion-imports');
  const [showImport, setShowImport] = useState(false);

  return (
    <>
      <PageHeader title="Manage Conversion Imports" subtitle="Reporting › Conversion Imports" />

      <div className="mb-4">
        <button type="button" onClick={() => setShowImport(true)} className="btn-primary flex items-center gap-1.5">
          <Plus size={15} /> Import Conversions
        </button>
      </div>

      <div className="card">
        {loading ? <StateBlock><Spinner /></StateBlock>
          : error ? <StateBlock>{error}</StateBlock>
          : !data?.length ? <StateBlock>No conversion imports yet — import some above.</StateBlock>
          : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full text-left text-body">
                <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Type</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Total Rows</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Total Processed</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Progress</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Conversion Errors</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Import Date</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Processed Date</th>
                    <th className="whitespace-nowrap px-4 py-3 font-semibold">Created By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.map((j) => {
                    const pct = j.row_count > 0 ? Math.round(((j.total_processed ?? 0) / j.row_count) * 100) : 0;
                    return (
                      <tr key={j.id} className="hover:bg-accent-subtle/40">
                        <td className="px-4 py-3 font-medium text-fg">{j.detail}</td>
                        <td className="px-4 py-3 text-right">{j.row_count}</td>
                        <td className="px-4 py-3 text-right">{j.total_processed ?? '—'}</td>
                        <td className="px-4 py-3 text-right">{pct}%</td>
                        <td className={`px-4 py-3 text-right ${j.error_count > 0 ? 'text-danger-text' : ''}`}>{j.error_count}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-small text-fg-secondary">{new Date(j.created_at).toLocaleString()}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-small text-fg-secondary">{j.processed_at ? new Date(j.processed_at).toLocaleString() : '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-small text-fg-secondary">{j.created_by_name ?? j.created_by_email ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={refetch} />}
    </>
  );
}
