/**
 * Offers › Custom Settings › Caps › Add / Edit — matches the reference's real single-step "Add
 * Custom Cap" page (verified live at /offers/customsettings/caps/add): Offer* + Partner* (both
 * single-select, unlike Revenue & Payout/Landing Pages' dual-list partner scoping), then the same
 * Click/Conversion/Payout/Revenue × Daily/Weekly/Monthly/Global "+"-row cap matrix already built for
 * Offer Groups (data/offerGroups.ts's CAP_TYPES/TIME_INTERVALS, reused verbatim).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';
import { CAP_TYPES, TIME_INTERVALS, TIME_INTERVAL_LABEL } from '../../data/offerGroups';
import type { CustomSetting } from '../../data/offerCustomSettings';
import type { Offer, Publisher } from '../../types';

type CapType = (typeof CAP_TYPES)[number]['key'];
type Interval = (typeof TIME_INTERVALS)[number];
interface CapRow { id: number; interval: Interval; value: string }

export default function OfferCustomSettingCapsForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const { data: existing } = useQuery<CustomSetting>(isEdit ? `/api/offer-custom-settings/${id}` : null);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');

  const [offerId, setOfferId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [capRows, setCapRows] = useState<Record<CapType, CapRow[]>>({ clicks: [], conversions: [], payout: [], revenue: [] });
  const nextId = useRef(1);
  const hydrated = useRef(false);

  useEffect(() => {
    if (existing && !hydrated.current) {
      hydrated.current = true;
      setOfferId(existing.offerId);
      setPartnerId(existing.partnerId ?? '');
      const rows: Record<CapType, CapRow[]> = { clicks: [], conversions: [], payout: [], revenue: [] };
      for (const t of CAP_TYPES) {
        const window = existing.caps[t.key];
        if (!window) continue;
        for (const interval of TIME_INTERVALS) {
          const v = (window as Record<string, number>)[interval];
          if (v != null) rows[t.key].push({ id: nextId.current++, interval, value: String(v) });
        }
      }
      setCapRows(rows);
    }
  }, [existing]);

  const addCapRow = (type: CapType) => setCapRows((r) => {
    const used = new Set(r[type].map((x) => x.interval));
    const next = TIME_INTERVALS.find((i) => !used.has(i)) ?? 'daily';
    return { ...r, [type]: [...r[type], { id: nextId.current++, interval: next, value: '' }] };
  });
  const removeCapRow = (type: CapType, rid: number) => setCapRows((r) => ({ ...r, [type]: r[type].filter((x) => x.id !== rid) }));
  const patchCapRow = (type: CapType, rid: number, patch: Partial<CapRow>) =>
    setCapRows((r) => ({ ...r, [type]: r[type].map((x) => (x.id === rid ? { ...x, ...patch } : x)) }));

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/offer-custom-settings/${id}`, body) : api.post('/api/offer-custom-settings', body));

  const submit = async () => {
    const caps: Record<string, Record<string, number>> = {};
    for (const t of CAP_TYPES) {
      const window: Record<string, number> = {};
      for (const row of capRows[t.key]) if (row.value !== '') window[row.interval] = Number(row.value);
      if (Object.keys(window).length) caps[t.key] = window;
    }
    const body = { category: 'caps', offerId, partnerId: partnerId || null, applyAllPartners: false, caps };
    const res = await run(body);
    if (res !== null) nav('/app/offers-custom-settings');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Custom Cap' : 'Add Custom Cap'} subtitle="Offers › Custom Settings › Caps" />
      <div className="card space-y-5">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

        <div className="flex max-w-2xl gap-3">
          <div className="flex-1"><Field label="Offer *">
            <select className="input" required value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <option value="">Select Offer…</option>
              {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.ref != null ? `(${o.ref}) ${o.name}` : o.name}</option>)}
            </select>
          </Field></div>
          <div className="flex-1"><Field label="Partner *">
            <select className="input" required value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">Select Partner…</option>
              {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.ref != null ? `(${p.ref}) ${p.name}` : p.name}</option>)}
            </select>
          </Field></div>
        </div>

        <div className="rounded-card border border-border bg-page p-4">
          {CAP_TYPES.map((t) => (
            <div key={t.key} className="border-b border-border py-3 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="text-small font-semibold text-fg">{t.label}</span>
                <button type="button" onClick={() => addCapRow(t.key)} title={`Add ${t.label}`}
                  className="grid h-7 w-7 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Plus size={13} /></button>
              </div>
              {capRows[t.key].map((row) => {
                const used = new Set(capRows[t.key].filter((x) => x.id !== row.id).map((x) => x.interval));
                return (
                  <div key={row.id} className="mt-2 flex items-end gap-2">
                    <div className="w-40"><Field label="Time Interval *">
                      <select className="input" value={row.interval} onChange={(e) => patchCapRow(t.key, row.id, { interval: e.target.value as Interval })}>
                        {TIME_INTERVALS.filter((i) => i === row.interval || !used.has(i)).map((i) => <option key={i} value={i}>{TIME_INTERVAL_LABEL[i]}</option>)}
                      </select>
                    </Field></div>
                    <div className="w-32"><Field label="Value *">
                      <input type="number" min={0} className="input" value={row.value} onChange={(e) => patchCapRow(t.key, row.id, { value: e.target.value })} />
                    </Field></div>
                    <button type="button" onClick={() => removeCapRow(t.key, row.id)} title="Remove"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-danger-bg hover:text-danger-text"><Trash2 size={14} /></button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => nav('/app/offers-custom-settings')}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!offerId || !partnerId || busy} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
      </div>
    </>
  );
}
