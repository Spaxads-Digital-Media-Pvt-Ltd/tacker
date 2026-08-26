/**
 * Bulk Add Coupon Codes (Partners › Coupon Codes › Bulk Add) — matches the reference's CSV import
 * flow: download a template, drag/drop or browse a CSV, preview resolved rows, then import. CSV
 * columns: coupon_code, offer_id, affiliate_id, status, description, notes, start_date, end_date —
 * offer_id/affiliate_id may be the numeric ref OR the exact name, resolved against the already-
 * fetched Offers/Partners lists (no server-side lookup needed for the preview).
 */
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UploadCloud } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader } from '../../components/ui';
import type { Offer, Publisher } from '../../types';

const TEMPLATE_CSV = 'coupon_code,offer_id,affiliate_id,status,description,notes,start_date,end_date\nSAVE10,,,active,,,,\n';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; } }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((c) => c.trim() !== '')) rows.push(row); }
  return rows;
}

interface PreviewRow {
  code: string; statusRaw: string; status: 'active' | 'expired' | 'disabled';
  offerRaw: string; offerId: string | null; offerName: string;
  partnerRaw: string; publisherId: string | null; publisherName: string;
  description: string; notes: string; startDate: string; endDate: string;
  error: string | null;
}

export default function CouponCodeImport() {
  const nav = useNavigate();
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bulk = useMutation((body: Record<string, unknown>) => api.post<{ created: number }>('/api/coupon-codes/bulk', body));

  const findOffer = (raw: string): Offer | undefined => {
    const v = raw.trim();
    if (!v) return undefined;
    return (offers ?? []).find((o) => String(o.ref ?? '') === v || o.name.toLowerCase() === v.toLowerCase() || o.id === v);
  };
  const findPublisher = (raw: string): Publisher | undefined => {
    const v = raw.trim();
    if (!v) return undefined;
    return (publishers ?? []).find((p) => String(p.ref ?? '') === v || p.name.toLowerCase() === v.toLowerCase() || p.id === v);
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    const text = await file.text();
    const table = parseCsv(text);
    if (table.length === 0) { setRows([]); return; }
    const header = table[0]!.map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    const iCode = idx('coupon_code'), iOffer = idx('offer_id'), iAff = idx('affiliate_id'), iStatus = idx('status');
    const iDesc = idx('description'), iNotes = idx('notes'), iStart = idx('start_date'), iEnd = idx('end_date');
    const parsed: PreviewRow[] = table.slice(1).slice(0, 100).map((cols) => {
      const code = (cols[iCode] ?? '').trim();
      const offerRaw = (cols[iOffer] ?? '').trim();
      const partnerRaw = (cols[iAff] ?? '').trim();
      const statusRaw = (cols[iStatus] ?? 'active').trim().toLowerCase();
      const status: PreviewRow['status'] = statusRaw === 'paused' || statusRaw === 'disabled' ? 'disabled' : statusRaw === 'expired' ? 'expired' : 'active';
      const offer = findOffer(offerRaw);
      const partner = findPublisher(partnerRaw);
      let error: string | null = null;
      if (!code) error = 'Missing coupon_code';
      else if (!offer) error = 'offer_id not found';
      else if (partnerRaw && !partner) error = 'affiliate_id not found';
      return {
        code, statusRaw, status, offerRaw, offerId: offer?.id ?? null, offerName: offer?.name ?? '',
        partnerRaw, publisherId: partner?.id ?? null, publisherName: partner?.name ?? '',
        description: (cols[iDesc] ?? '').trim(), notes: (cols[iNotes] ?? '').trim(),
        startDate: (cols[iStart] ?? '').trim(), endDate: (cols[iEnd] ?? '').trim(),
        error,
      };
    });
    setRows(parsed);
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'coupon_codes_template.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const validRows = rows.filter((r) => !r.error);
  const doImport = async () => {
    const items = validRows.map((r) => ({
      code: r.code, status: r.status, offerId: r.offerId!, publisherId: r.publisherId,
      description: r.description || null, notes: r.notes || null,
      startsAt: r.startDate ? new Date(r.startDate).toISOString() : null,
      endsAt: r.endDate ? new Date(r.endDate).toISOString() : null,
    }));
    const res = await bulk.run({ items });
    if (res) nav('/app/aff-coupons');
  };

  return (
    <>
      <PageHeader title="Bulk Add Coupon Codes" subtitle="Partners › Coupon Codes › Bulk Add" />
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="card space-y-3">
          <p className="text-small text-fg-secondary">
            CSV must include <code className="rounded bg-page px-1 py-0.5 text-tiny">coupon_code, offer_id, affiliate_id, status</code> columns
            (offer_id/affiliate_id may be the numeric ID or the exact name). Max 100 rows per import.
          </p>
          <button type="button" onClick={downloadTemplate} className="btn-ghost w-fit">Download Template</button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => fileRef.current?.click()}
          className={`card flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed py-10 text-center transition-colors ${dragOver ? 'border-accent-text bg-accent-subtle' : 'border-border'}`}
        >
          <UploadCloud size={28} className="text-fg-muted" />
          <p className="text-small text-fg">Drag & drop a CSV file, or click to browse</p>
          {fileName && <p className="text-tiny text-fg-secondary">{fileName} — {rows.length} row{rows.length === 1 ? '' : 's'} parsed</p>}
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>

        {bulk.error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{bulk.error}</p>}

        {rows.length > 0 && (
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-h3 font-medium text-fg">Preview</h3>
              <span className="text-tiny text-fg-secondary">{validRows.length} of {rows.length} rows valid</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-small">
                <thead>
                  <tr className="border-b border-border text-tiny uppercase text-fg-secondary">
                    <th className="py-2 pr-3">Coupon Code</th>
                    <th className="py-2 pr-3">Partner</th>
                    <th className="py-2 pr-3">Offer</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Start</th>
                    <th className="py-2 pr-3">End</th>
                    <th className="py-2 pr-3">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={`border-b border-border ${r.error ? 'bg-danger-bg/40' : ''}`}>
                      <td className="py-2 pr-3 text-fg">{r.code || <span className="text-fg-muted">-</span>}</td>
                      <td className="py-2 pr-3 text-fg">{r.publisherName || (r.partnerRaw ? <span className="text-danger-text">{r.partnerRaw}?</span> : <span className="text-fg-muted">-</span>)}</td>
                      <td className="py-2 pr-3 text-fg">{r.offerName || <span className="text-danger-text">{r.offerRaw || '—'}?</span>}</td>
                      <td className="py-2 pr-3 text-fg">{r.status === 'disabled' ? 'Paused' : r.status === 'expired' ? 'Expired' : 'Active'}</td>
                      <td className="py-2 pr-3 text-fg-secondary">{r.startDate || '-'}</td>
                      <td className="py-2 pr-3 text-fg-secondary">{r.endDate || '-'}</td>
                      <td className="py-2 pr-3 text-fg-secondary">{r.description || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.some((r) => r.error) && <p className="mt-2 text-tiny text-danger-text">Rows highlighted in red have an error and will be skipped.</p>}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Link to="/app/aff-coupons" className="btn-ghost">Cancel</Link>
          <button type="button" className="btn-primary" disabled={validRows.length === 0 || bulk.busy} onClick={doImport}>
            {bulk.busy ? 'Importing…' : `Import ${validRows.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </>
  );
}
