/**
 * Offers › Groups › Add / Edit — matches the reference's real 2-step "Add Offer Group" wizard
 * (verified live at /offers/groups/add): step 1 "General" (Name/Status/Advertiser+Currency, a
 * bracket-connected Offers dual-list picker scoped to the chosen advertiser, Labels, Notes), step 2
 * "Tracking & Controls" (an "Enable Caps" toggle guarding four cap-type sections — Click/Conversion/
 * Payout/Revenue — each a bracket-connected "+"-row list of Time Interval [Daily/Weekly/Monthly/
 * Global] + Value, the same pattern already used for Offer Templates' Prefilled Fields).
 *
 * The caps are stored and shown in Pacing but NOT enforced (nothing reads them on the click or
 * conversion path) — the caps step says so. A new group's currency starts at the network's default
 * currency (GET /api/settings, as the report pages read it); editing keeps the stored one.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field } from '../../shared-components/primitives/ui';
import { ToggleRow } from '../../shared-components/primitives/ToggleRow';
import { Stepper } from '../../shared-components/panels/Stepper';
import { FormLayout } from '../../shared-components/forms/FormLayout';
import { FormFooter } from '../../shared-components/forms/FormFooter';
import { UpNextCard } from '../../shared-components/forms/UpNextCard';
import { StatusChoice } from '../../shared-components/forms/ChoiceCards';
import { DualListPicker } from '../../shared-components/panels/DualListPicker';
import { CAP_TYPES, TIME_INTERVALS, TIME_INTERVAL_LABEL, CURRENCIES, type OfferGroup } from '../../data/offerGroups';
import { NotEnforcedNote } from '../../shared-components/primitives/NotEnforcedBadge';
import type { Advertiser, Offer } from '../../types';

type CapType = (typeof CAP_TYPES)[number]['key'];
type Interval = (typeof TIME_INTERVALS)[number];
interface CapRow { id: number; interval: Interval; value: string }
const STEPS = ['General', 'Tracking & Controls'];
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', tone: 'success' }, { value: 'paused', label: 'Paused', tone: 'warning' }, { value: 'deleted', label: 'Deleted', tone: 'danger' },
] as const;

export default function OfferGroupForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const { data: existing } = useQuery<OfferGroup>(isEdit ? `/api/offer-groups/${id}` : null);
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: settings } = useQuery<{ general?: { defaultCurrency?: string } }>(isEdit ? null : '/api/settings');
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<1 | 2>(searchParams.get('tab') === 'tracking' ? 2 : 1);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'paused' | 'deleted'>('active');
  const [advertiserId, setAdvertiserId] = useState('');
  const [currency, setCurrency] = useState('USD');
  // Create: preselect the network's default currency once it loads, unless the user already picked one.
  const currencyTouched = useRef(false);
  const networkCurrency = settings?.general?.defaultCurrency;
  useEffect(() => {
    if (!isEdit && networkCurrency && !currencyTouched.current) setCurrency(networkCurrency.toUpperCase());
  }, [isEdit, networkCurrency]);
  // The list has the common codes; a network/stored currency outside it is still offered as itself.
  const currencyOptions = CURRENCIES.some((c) => c.value === currency) ? CURRENCIES : [...CURRENCIES, { value: currency, label: currency }];
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

      <Stepper steps={STEPS} current={step - 1} onStepClick={(i) => setStep((i + 1) as 1 | 2)} />
      {/* No field hints anywhere → centred card on both steps; Up next sits below the card. */}
      <FormLayout caption={`Step ${step}`} title={STEPS[step - 1]} requiredNote="Fields with an asterisk (*) are mandatory." layout="centered"
        upNext={step === 1 ? <UpNextCard number={2} name={STEPS[1]!} /> : undefined}>
      <div className="space-y-5">
        {error && <p className="text-small text-danger-text">{error}</p>}

        {step === 1 ? (
          <div className="space-y-4">
            <Field label="Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div>
              <span id="offer-group-status-label" className="label">Status *</span>
              <StatusChoice options={STATUS_OPTIONS} value={status} onChange={setStatus} ariaLabelledby="offer-group-status-label" />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_14rem] md:items-end">
              <div><Field label="Advertiser *">
                <select className="input" required value={advertiserId} onChange={(e) => { setAdvertiserId(e.target.value); setOfferIds([]); }}>
                  <option value="">Select Advertiser…</option>
                  {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.ref != null ? `(${a.ref}) ${a.name}` : a.name}</option>)}
                </select>
              </Field></div>
              <div><Field label="Currency *">
                <select className="input" value={currency} onChange={(e) => { currencyTouched.current = true; setCurrency(e.target.value); }}>
                  {currencyOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field></div>
            </div>

            {advertiserId && (
              <div className="ml-3 border-l-2 border-border pl-4">
                <Field label="Offers *"><DualListPicker options={offerOptions} selected={offerIds} onChange={setOfferIds} /></Field>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Labels"><textarea className="input min-h-[70px]" value={labels} onChange={(e) => setLabels(e.target.value)} /></Field>
              <Field label="Notes (internal)"><textarea className="input min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <ToggleRow label="Enable Caps" checked={capsEnabled} onChange={() => setCapsEnabled((v) => !v)} />
            {/* Nothing reads offer-group caps on the click or conversion path; the offers' own caps
                (Offer → Tracking & Controls) are the ones that block traffic. */}
            <NotEnforcedNote />

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

      </div>
      </FormLayout>
      {step === 1 ? (
        <FormFooter key="general" stepText={`Step 1 of ${STEPS.length}`}
          cancel={<button type="button" className="btn-ghost" onClick={() => nav('/app/offers-groups')}>Cancel</button>}
          primary={{ label: `Next: ${STEPS[1]}`, shortLabel: 'Next', type: 'button', disabled: !name || !advertiserId || offerIds.length === 0, onClick: () => setStep(2) }} />
      ) : (
        <FormFooter key="caps" stepText={`Step 2 of ${STEPS.length}`}
          cancel={<button type="button" className="btn-ghost" onClick={() => setStep(1)}>Back</button>}
          primary={{ label: busy ? 'Saving…' : isEdit ? 'Save' : 'Add', type: 'button', disabled: busy, onClick: submit }} />
      )}
    </>
  );
}
