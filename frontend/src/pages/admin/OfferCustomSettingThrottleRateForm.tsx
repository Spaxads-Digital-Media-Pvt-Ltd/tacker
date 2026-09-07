/**
 * Offers › Custom Settings › Throttle Rates › Add / Edit — matches the reference's real 2-step
 * "Add Custom Throttle Rate" wizard (verified live at /offers/customsettings/scrubrates/add):
 * "General" (Name/Status, Partner + Offer single-selects (both required), Conversion Status Rejected/Pending toggle,
 * Throttle Rate %, Set Parameter Goal) and "Targeting" (reduced honest subset, see
 * components/CustomSettingFields.tsx).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';
import { StatusToggle, TargetingStep, YesNoToggle } from '../../components/CustomSettingFields';
import type { CustomSetting, Targeting } from '../../data/offerCustomSettings';
import type { Offer, Publisher } from '../../types';

export default function OfferCustomSettingThrottleRateForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const { data: existing } = useQuery<CustomSetting>(isEdit ? `/api/offer-custom-settings/${id}` : null);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [partnerId, setPartnerId] = useState('');
  const [offerId, setOfferId] = useState('');
  const [conversionStatus, setConversionStatus] = useState<'rejected' | 'pending'>('pending');
  const [throttleRate, setThrottleRate] = useState('');
  const [setParameterGoal, setSetParameterGoal] = useState(false);
  const [targeting, setTargeting] = useState<Targeting>({});
  const hydrated = useRef(false);

  useEffect(() => {
    if (existing && !hydrated.current) {
      hydrated.current = true;
      setName(existing.name ?? '');
      setStatus(existing.status === 'inactive' ? 'inactive' : 'active');
      setPartnerId(existing.partnerId ?? '');
      setOfferId(existing.offerId);
      setConversionStatus(existing.conversionStatus ?? 'pending');
      setThrottleRate(existing.throttleRate ?? '');
      setSetParameterGoal(existing.setParameterGoal);
      setTargeting(existing.targeting ?? {});
    }
  }, [existing]);

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/offer-custom-settings/${id}`, body) : api.post('/api/offer-custom-settings', body));

  const valid = !!name && !!partnerId && !!offerId && throttleRate !== '';

  const submit = async () => {
    const body = {
      category: 'throttle_rates', name, status, partnerId, applyAllPartners: false, offerId,
      conversionStatus, throttleRate: Number(throttleRate), setParameterGoal, targeting,
    };
    const res = await run(body);
    if (res !== null) nav('/app/offers-custom-settings');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Custom Throttle Rate' : 'Add Custom Throttle Rate'} subtitle="Offers › Custom Settings › Throttle Rates" />

      <div className="mb-6 flex items-center gap-6 border-b border-border pb-4">
        {(['General', 'Targeting'] as const).map((label, i) => {
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
            <Field label="Status *"><StatusToggle value={status} onChange={setStatus} /></Field>

            <div className="flex max-w-2xl gap-3">
              <div className="flex-1"><Field label="Partner *">
                <select className="input" required value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                  <option value="">Select Partner…</option>
                  {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.ref != null ? `(${p.ref}) ${p.name}` : p.name}</option>)}
                </select>
              </Field></div>
              <div className="flex-1"><Field label="Offer *">
                <select className="input" required value={offerId} onChange={(e) => setOfferId(e.target.value)}>
                  <option value="">Select Offer…</option>
                  {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.ref != null ? `(${o.ref}) ${o.name}` : o.name}</option>)}
                </select>
              </Field></div>
            </div>

            <div className="flex max-w-md items-end gap-3">
              <Field label="Conversion Status *">
                <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
                  {(['rejected', 'pending'] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setConversionStatus(s)}
                      className={`flex items-center justify-center gap-1.5 px-4 py-2 text-small capitalize ${conversionStatus === s ? 'bg-page font-medium text-fg' : 'text-fg-secondary'}`}>
                      <span className={`h-2 w-2 rounded-full ${s === 'rejected' ? 'bg-danger' : 'bg-warning'}`} />{s}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="w-32"><Field label="Throttle Rate *">
                <div className="relative">
                  <input type="number" min={0} max={100} step="0.01" className="input pr-7" value={throttleRate} onChange={(e) => setThrottleRate(e.target.value)} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-small text-fg-secondary">%</span>
                </div>
              </Field></div>
            </div>

            <Field label="Set Parameter Goal"><YesNoToggle value={setParameterGoal} onChange={setSetParameterGoal} /></Field>
          </div>
        ) : (
          <TargetingStep value={targeting} onChange={setTargeting} />
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        {step === 1 ? (
          <>
            <button type="button" className="btn-ghost" onClick={() => nav('/app/offers-custom-settings')}>Cancel</button>
            <button type="button" className="btn-primary" disabled={!valid} onClick={() => setStep(2)}>Next</button>
          </>
        ) : (
          <>
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button type="button" className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </>
        )}
      </div>
    </>
  );
}
