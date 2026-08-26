/**
 * Add/Edit Reporting Adjustment — matches the reference's Settings (Date range/Partner/Offer)
 * section followed by a per-day Adjustments table. Each day's Revenue/Payout/etc default to the
 * real aggregate from clicks/conversions (computed server-side, not fabricated); the pencil icon
 * opens a per-day override modal. Margin/CVR/Profit are derived, read-only.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Modal, Table, Spinner, StateBlock, type Column } from '../../components/ui';
import type { Publisher, Offer, ReportingAdjustmentDetail, ReportingAdjustmentDayOverride } from '../../types';

interface PreviewResponse {
  publisherName: string; offerName: string; offerDefaultRevenue: number; offerDefaultPayout: number;
  days: { date: string; original: Record<string, number>; adjusted: Record<string, number>; override: null; notes: null }[];
}

interface DayRow {
  date: string;
  original: { revenue: number; payout: number; grossSales: number; totalClicks: number; uniqueClicks: number; conversions: number; impressions: number };
}

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

function DayEditModal({
  day, override, onClose, onSave,
}: { day: DayRow; override: ReportingAdjustmentDayOverride | undefined; onClose: () => void; onSave: (v: ReportingAdjustmentDayOverride) => void }) {
  const [form, setForm] = useState({
    revenue: String(override?.revenue ?? day.original.revenue), payout: String(override?.payout ?? day.original.payout),
    grossSales: String(override?.grossSales ?? day.original.grossSales), totalClicks: String(override?.totalClicks ?? day.original.totalClicks),
    uniqueClicks: String(override?.uniqueClicks ?? day.original.uniqueClicks), conversions: String(override?.conversions ?? day.original.conversions),
    impressions: String(override?.impressions ?? day.original.impressions), notes: override?.notes ?? '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    onSave({
      date: day.date,
      revenue: Number(form.revenue), payout: Number(form.payout), grossSales: Number(form.grossSales),
      totalClicks: Number(form.totalClicks), uniqueClicks: Number(form.uniqueClicks),
      conversions: Number(form.conversions), impressions: Number(form.impressions),
      notes: form.notes || null,
    });
    onClose();
  };
  const resetToOriginal = () => setForm({
    revenue: String(day.original.revenue), payout: String(day.original.payout), grossSales: String(day.original.grossSales),
    totalClicks: String(day.original.totalClicks), uniqueClicks: String(day.original.uniqueClicks),
    conversions: String(day.original.conversions), impressions: String(day.original.impressions), notes: '',
  });

  return (
    <Modal open onClose={onClose} title={`Adjust ${day.date}`} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Revenue"><input className="input" type="number" step="0.01" value={form.revenue} onChange={(e) => set('revenue', e.target.value)} /></Field>
          <Field label="Payout"><input className="input" type="number" step="0.01" value={form.payout} onChange={(e) => set('payout', e.target.value)} /></Field>
          <Field label="Gross Sales"><input className="input" type="number" step="0.01" value={form.grossSales} onChange={(e) => set('grossSales', e.target.value)} /></Field>
          <Field label="Impressions"><input className="input" type="number" step="1" value={form.impressions} onChange={(e) => set('impressions', e.target.value)} /></Field>
          <Field label="Total Clicks"><input className="input" type="number" step="1" value={form.totalClicks} onChange={(e) => set('totalClicks', e.target.value)} /></Field>
          <Field label="Unique Clicks"><input className="input" type="number" step="1" value={form.uniqueClicks} onChange={(e) => set('uniqueClicks', e.target.value)} /></Field>
          <Field label="Conversions"><input className="input" type="number" step="1" value={form.conversions} onChange={(e) => set('conversions', e.target.value)} /></Field>
        </div>
        <Field label="Notes"><textarea className="input min-h-[70px]" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="flex justify-between border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={resetToOriginal}>Reset to Original</button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function AdjustmentForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading: loadingExisting } = useQuery<ReportingAdjustmentDetail>(isEdit ? `/api/reporting-adjustments/${id}` : null);
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/reporting-adjustments', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/reporting-adjustments/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  const [publisherId, setPublisherId] = useState('');
  const [offerId, setOfferId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [overrides, setOverrides] = useState<Record<string, ReportingAdjustmentDayOverride>>({});
  const [editingDay, setEditingDay] = useState<DayRow | null>(null);

  useEffect(() => {
    if (!existing) return;
    setPublisherId(existing.publisherId); setOfferId(existing.offerId);
    setDateFrom(existing.dateFrom); setDateTo(existing.dateTo);
    const initial: Record<string, ReportingAdjustmentDayOverride> = {};
    for (const d of existing.days) if (d.override) initial[d.date] = d.override;
    setOverrides(initial);
  }, [existing]);

  const previewPath = publisherId && offerId && dateFrom && dateTo
    ? `/api/reporting-adjustments/preview?publisherId=${publisherId}&offerId=${offerId}&dateFrom=${dateFrom}&dateTo=${dateTo}`
    : null;
  const { data: preview, loading: loadingPreview } = useQuery<PreviewResponse>(!isEdit ? previewPath : null);

  const days: DayRow[] = useMemo(() => {
    if (isEdit && existing) return existing.days.map((d) => ({ date: d.date, original: d.original }));
    if (preview) return preview.days.map((d) => ({ date: d.date, original: d.original as DayRow['original'] }));
    return [];
  }, [isEdit, existing, preview]);

  if (isEdit && loadingExisting) return <StateBlock><Spinner /></StateBlock>;

  const offer = (offers ?? []).find((o) => o.id === offerId);

  const displayValue = (day: DayRow, key: keyof DayRow['original']): number => {
    const ov = overrides[day.date];
    return (ov?.[key] as number | undefined) ?? day.original[key];
  };

  const columns: Column<DayRow>[] = [
    { header: 'Date', cell: (d) => d.date },
    { header: 'Revenue', cell: (d) => money(displayValue(d, 'revenue')) },
    { header: 'Payout', cell: (d) => money(displayValue(d, 'payout')) },
    { header: 'Gross Sales', cell: (d) => money(displayValue(d, 'grossSales')) },
    { header: 'Total Clicks', cell: (d) => displayValue(d, 'totalClicks') },
    { header: 'Unique Clicks', cell: (d) => displayValue(d, 'uniqueClicks') },
    { header: 'Conversions', cell: (d) => displayValue(d, 'conversions') },
    { header: 'Impressions', cell: (d) => displayValue(d, 'impressions') },
    {
      header: 'Margin', cell: (d) => {
        const rev = displayValue(d, 'revenue'); const pay = displayValue(d, 'payout');
        return pct(rev > 0 ? (rev - pay) / rev : 0);
      },
    },
    {
      header: 'CVR', cell: (d) => {
        const clicks = displayValue(d, 'totalClicks'); const conv = displayValue(d, 'conversions');
        return pct(clicks > 0 ? conv / clicks : 0);
      },
    },
    { header: 'Profit', cell: (d) => money(displayValue(d, 'revenue') - displayValue(d, 'payout')) },
    { header: 'Notes', cell: (d) => overrides[d.date]?.notes || <span className="text-fg-muted">-</span> },
    { header: '', className: 'text-right', cell: (d) => <button type="button" onClick={() => setEditingDay(d)} className="grid h-8 w-8 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle"><Pencil size={13} /></button> },
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { publisherId, offerId, dateFrom, dateTo, days: Object.values(overrides) };
    const res = isEdit ? await update.run(body) : await create.run(body);
    if (res) nav('/app/aff-adjustments');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Reporting Adjustment' : 'Add Reporting Adjustment'} subtitle={`Partners › Adjustments › ${isEdit ? 'Edit' : 'Add'}`} />
      <form onSubmit={submit} className="space-y-6">
        {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
        <div className="card max-w-2xl mx-auto space-y-4">
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
          <h3 className="text-h3 font-medium text-fg">Settings</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date From *"><input type="date" className="input" required value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></Field>
            <Field label="Date To *"><input type="date" className="input" required value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></Field>
          </div>
          <Field label="Partner *">
            <select className="input" required disabled={isEdit} value={publisherId} onChange={(e) => setPublisherId(e.target.value)}>
              <option value="" disabled>Select Partner…</option>
              {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Offer *">
            <select className="input" required disabled={isEdit} value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <option value="" disabled>Select Offer…</option>
              {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          {offer && (
            <p className="text-tiny text-fg-secondary">
              Offer Base Revenue &amp; Payout: <span className="font-medium text-fg">RPM: ${Number(offer.defaultRevenue).toFixed(3)}</span>{' '}
              <span className="font-medium text-fg">PRV: {Number(offer.defaultRevenue) > 0 ? ((Number(offer.defaultPayout) / Number(offer.defaultRevenue)) * 100).toFixed(2) : '0.00'}%</span>
            </p>
          )}
        </div>

        <div className="card">
          <h3 className="mb-3 text-h3 font-medium text-fg">Adjustments</h3>
          {!publisherId || !offerId || !dateFrom || !dateTo
            ? <StateBlock>Select a Partner, Offer and Date range to load days.</StateBlock>
            : loadingPreview ? <StateBlock><Spinner /></StateBlock>
            : !days.length ? <StateBlock>No Record Found</StateBlock>
            : <Table columns={columns} rows={days} rowKey={(d) => d.date} />}
        </div>

        <div className="flex justify-end gap-2">
          <Link to="/app/aff-adjustments" className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={busy || !days.length}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
        </div>
      </form>

      {editingDay && (
        <DayEditModal day={editingDay} override={overrides[editingDay.date]} onClose={() => setEditingDay(null)}
          onSave={(v) => setOverrides((o) => ({ ...o, [editingDay.date]: v }))} />
      )}
    </>
  );
}
