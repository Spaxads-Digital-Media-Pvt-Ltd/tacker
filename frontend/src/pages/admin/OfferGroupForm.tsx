/**
 * Offers › Groups › Add / Edit — matches the reference's real 2-step "Add Offer Group" wizard
 * (verified live at /offers/groups/add): step 1 "General" (Name/Status/Advertiser+Currency, a
 * bracket-connected Offers dual-list picker scoped to the chosen advertiser, Labels, Notes), step 2
 * "Tracking & Controls" (an "Enable Caps" toggle guarding four cap-type sections — Click/Conversion/
 * Payout/Revenue — each a bracket-connected "+"-row list of Time Interval [Daily/Weekly/Monthly/
 * Global] + Value, the same pattern already used for Offer Templates' Prefilled Fields).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Segmented } from '../../components/ui';
import { DualListPicker } from '../../components/DualListPicker';
import { CAP_TYPES, TIME_INTERVALS, TIME_INTERVAL_LABEL, CURRENCIES, type OfferGroup } from '../../data/offerGroups';
import type { Advertiser, Offer } from '../../types';

type CapType = (typeof CAP_TYPES)[number]['key'];
type Interval = (typeof TIME_INTERVALS)[number];
interface CapRow { id: number; interval: Interval; value: string }

export default function OfferGroupForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const { data: existing } = useQuery<OfferGroup>(isEdit ? `/api/offer-groups/${id}` : null);
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<1 | 2>(searchParams.get('tab') === 'tracking' ? 2 : 1);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'paused' | 'deleted'>('active');
  const [advertiserId, setAdvertiserId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [labels, setLabels] = useState('');
  const [notes, setNotes] = useState('');

  const [capsEnabled, setCapsEnabled] = useState(false);
  const [capRows, setCapRows] = useState<Record<CapType, CapRow[]>>({ clicks: [], conversions: [], payout: [], revenue: [] });
  const nextId = useRef(1);
  const hydrated = useRef(false);

  useEffect(() => {
    if (existing && !hydrated.current) {
      hydrated.current = true;
      setName(existing.name);
      setStatus(existing.status as typeof status);
      setAdvertiserId(existing.advertiserId ?? '');
      setCurrency(existing.currency);
      setOfferIds(existing.offerIds);
      setLabels(existing.labels ?? '');
      setNotes(existing.notes ?? '');
      setCapsEnabled(existing.capsEnabled);
      const rows: Record<CapType, CapRow[]> = { clicks: [], conversions: [], payout: [], revenue: [] };
      for (const t of CAP_TYPES) {
        const window = existing.caps[t.key];
        if (!window) continue;
        for (const interval of TIME_INTERVALS) {
          const v = window[interval];
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

  const offerOptions = (offers ?? [])
    .filter((o) => !advertiserId || o.advertiserId === advertiserId)
    .map((o) => ({ value: o.id, label: o.ref != null ? `(${o.ref}) ${o.name}` : o.name, active: o.status === 'active' }));

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/offer-groups/${id}`, body) : api.post('/api/offer-groups', body));

  const submit = async () => {
    const caps: Record<string, Record<string, number>> = {};
    for (const t of CAP_TYPES) {
      const window: Record<string, number> = {};
      for (const row of capRows[t.key]) if (row.value !== '') window[row.interval] = Number(row.value);
      if (Object.keys(window).length) caps[t.key] = window;
    }
    const body = {
      name, status, advertiserId: advertiserId || null, offerIds, currency,
      labels: labels || null, notes: notes || null, capsEnabled, caps,
    };
    const res = await run(body);
    if (res !== null) nav('/app/offers-groups');
  };

  return (
    <>
      <PageHeader title={isEdit ? `Edit Offer Group${existing ? `: ${existing.name}` : ''}` : 'Add Offer Group'} subtitle={`Offers › Groups › ${isEdit ? 'Edit' : 'Add'}`} />

      <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-6 border-b border-border pb-4">
        {(['General', 'Tracking & Controls'] as const).map((label, i) => {
          const n = (i + 1) as 1 | 2;
          const on = step === n;
          return (
            <button key={label} type="button" onClick={() => setStep(n)} className="flex items-center gap-2">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-tiny font-semibold ${on ? 'bg-accent text-accent-fg' : 'border border-border text-fg-secondary'}`}>{n}</span>
              <span className={`text-small font-medium ${on ? 'text-accent-text' : 'text-fg-secondary'}`}>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="card space-y-5">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

        {step === 1 ? (
          <div className="space-y-4">
            <div className="max-w-md"><Field label="Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
            <div className="max-w-md"><Field label="Status *">
              <Segmented
                options={['active', 'paused', 'deleted']}
                value={status}
                onChange={(v) => setStatus(v as typeof status)}
                dots={{ active: 'bg-success', paused: 'bg-warning', deleted: 'bg-danger' }}
              />
            </Field></div>

            <div className="flex max-w-2xl items-end gap-2">
              <div className="flex-1"><Field label="Advertiser *">
                <select className="input" required value={advertiserId} onChange={(e) => { setAdvertiserId(e.target.value); setOfferIds([]); }}>
                  <option value="">Select Advertiser…</option>
                  {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.ref != null ? `(${a.ref}) ${a.name}` : a.name}</option>)}
                </select>
              </Field></div>
              <div className="w-56"><Field label="Currency *">
                <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field></div>
            </div>

            {advertiserId && (
              <div className="ml-3 max-w-2xl border-l-2 border-border pl-4">
                <Field label="Offers *"><DualListPicker options={offerOptions} selected={offerIds} onChange={setOfferIds} /></Field>
              </div>
            )}

            <div className="max-w-md"><Field label="Labels"><textarea className="input min-h-[70px]" value={labels} onChange={(e) => setLabels(e.target.value)} /></Field></div>
            <div className="max-w-md"><Field label="Notes (internal)"><textarea className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
          </div>
        ) : (
          <div className="max-w-2xl space-y-5">
            <Field label="Enable Caps">
              <button type="button" onClick={() => setCapsEnabled((v) => !v)}
                className={`flex w-24 items-center rounded-full border border-border p-0.5 text-tiny font-medium ${capsEnabled ? 'justify-end bg-accent-subtle text-accent-text' : 'justify-start text-fg-secondary'}`}>
                <span className="rounded-full bg-surface px-2 py-1 shadow-sm">{capsEnabled ? 'Yes' : 'No'}</span>
              </button>
            </Field>
            <p className="text-[11px] text-fg-muted">
              Stored on the group for reference and reporting. Group-level shared caps aren't enforced at the click hot path yet —
              only each offer's own Daily Click Cap is (Offer → Tracking &amp; Controls).
            </p>

            {capsEnabled && (
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
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          {step === 1 ? (
            <>
              <button type="button" className="btn-ghost" onClick={() => nav('/app/offers-groups')}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!name || !advertiserId || offerIds.length === 0} onClick={() => setStep(2)}>Next</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
            </>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
