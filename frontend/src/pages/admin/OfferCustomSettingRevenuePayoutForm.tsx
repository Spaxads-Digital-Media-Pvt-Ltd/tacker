/**
 * Offers › Custom Settings › Revenue & Payout › Add / Edit — matches the reference's real wizard
 * (verified live at /offers/customsettings/payoutrevenues/add), scoped to two steps: "General"
 * (Name/Status/Description/Public Description/Effective Between, Custom Payout/Revenue toggles each
 * with a real 10-option payout-model dropdown + value, Partners Conditions, Fire Partner Postback,
 * Offer Conditions — Offer + Event, the event list drawn from that offer's own real goals) and
 * "Targeting" (see components/CustomSettingFields.tsx for why it's a reduced honest subset — the
 * reference's own "Parameters"/"Products" steps are dropped: this app has no sub-parameter-condition
 * system or per-offer product catalog to back them honestly).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';
import { EffectiveBetweenField, PartnersConditionField, StatusToggle, TargetingStep, YesNoToggle } from '../../components/CustomSettingFields';
import { PAYOUT_MODELS, type CustomSetting, type PayoutModel, type Targeting } from '../../data/offerCustomSettings';
import type { Offer, Publisher } from '../../types';

interface Goal { id: string; name: string; eventName: string | null; isDefault: boolean }

export default function OfferCustomSettingRevenuePayoutForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const { data: existing } = useQuery<CustomSetting>(isEdit ? `/api/offer-custom-settings/${id}` : null);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [description, setDescription] = useState('');
  const [publicDescription, setPublicDescription] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');

  const [applyCustomPayout, setApplyCustomPayout] = useState(false);
  const [payoutModel, setPayoutModel] = useState<PayoutModel>('CPA');
  const [payoutValue, setPayoutValue] = useState('');
  const [applyCustomRevenue, setApplyCustomRevenue] = useState(false);
  const [revenueModel, setRevenueModel] = useState<PayoutModel>('CPA');
  const [revenueValue, setRevenueValue] = useState('');

  const [applyAllPartners, setApplyAllPartners] = useState(false);
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [firePartnerPostback, setFirePartnerPostback] = useState(true);

  const [offerId, setOfferId] = useState('');
  const [goalId, setGoalId] = useState('');
  const { data: goals } = useQuery<Goal[]>(offerId ? `/api/offers/${offerId}/goals` : null);

  const [targeting, setTargeting] = useState<Targeting>({});
  const hydrated = useRef(false);

  useEffect(() => {
    if (existing && !hydrated.current) {
      hydrated.current = true;
      setName(existing.name ?? '');
      setStatus(existing.status === 'inactive' ? 'inactive' : 'active');
      setDescription(existing.description ?? '');
      setPublicDescription(existing.publicDescription ?? '');
      setEffectiveFrom(existing.effectiveFrom ? existing.effectiveFrom.slice(0, 16) : '');
      setEffectiveTo(existing.effectiveTo ? existing.effectiveTo.slice(0, 16) : '');
      setApplyCustomPayout(existing.applyCustomPayout);
      setPayoutModel((existing.payoutModel as PayoutModel) ?? 'CPA');
      setPayoutValue(existing.payoutValue ?? '');
      setApplyCustomRevenue(existing.applyCustomRevenue);
      setRevenueModel((existing.revenueModel as PayoutModel) ?? 'CPA');
      setRevenueValue(existing.revenueValue ?? '');
      setApplyAllPartners(existing.applyAllPartners);
      setPartnerIds(existing.partnerIds);
      setFirePartnerPostback(existing.firePartnerPostback);
      setOfferId(existing.offerId);
      setGoalId(existing.goalId ?? '');
      setTargeting(existing.targeting ?? {});
    }
  }, [existing]);

  const partnerOptions = (publishers ?? []).map((p) => ({ value: p.id, label: p.ref != null ? `(${p.ref}) ${p.name}` : p.name, active: p.status === 'active' }));

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/offer-custom-settings/${id}`, body) : api.post('/api/offer-custom-settings', body));

  const valid = !!name && (applyCustomPayout || applyCustomRevenue) && (applyAllPartners || partnerIds.length > 0) && !!offerId;

  const submit = async () => {
    const body = {
      category: 'revenue_payout', name, status, description: description || null, publicDescription: publicDescription || null,
      effectiveFrom: effectiveFrom || null, effectiveTo: effectiveTo || null,
      applyCustomPayout, payoutModel: applyCustomPayout ? payoutModel : null, payoutValue: applyCustomPayout && payoutValue !== '' ? Number(payoutValue) : null,
      applyCustomRevenue, revenueModel: applyCustomRevenue ? revenueModel : null, revenueValue: applyCustomRevenue && revenueValue !== '' ? Number(revenueValue) : null,
      applyAllPartners, partnerIds: applyAllPartners ? [] : partnerIds, firePartnerPostback,
      offerId, goalId: goalId || null, targeting,
    };
    const res = await run(body);
    if (res !== null) nav('/app/offers-custom-settings');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Custom Revenue & Payout' : 'Add Custom Revenue & Payout'} subtitle="Offers › Custom Settings › Revenue & Payout" />

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
          <div className="space-y-5">
            <div className="max-w-md"><Field label="Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
            <Field label="Status *"><StatusToggle value={status} onChange={setStatus} /></Field>
            <div className="max-w-md"><Field label="Description"><textarea className="input min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
            <div className="max-w-md"><Field label="Public Description"><textarea className="input min-h-[60px]" value={publicDescription} onChange={(e) => setPublicDescription(e.target.value)} /></Field></div>
            <EffectiveBetweenField from={effectiveFrom} to={effectiveTo} onChange={(f, t) => { setEffectiveFrom(f); setEffectiveTo(t); }} />

            <div className="border-t border-border pt-4">
              <p className="mb-1 text-h3 font-medium text-fg">Custom Revenue & Payout *</p>
              <p className="mb-3 text-tiny text-fg-secondary">Please note that you must customize either the Revenue, the Payout, or both.</p>
              <Field label="Apply Custom Payout"><YesNoToggle value={applyCustomPayout} onChange={setApplyCustomPayout} /></Field>
              {applyCustomPayout && (
                <div className="ml-3 mt-2 flex max-w-md gap-2 border-l-2 border-border pl-4">
                  <div className="flex-1"><Field label="Payout *">
                    <select className="input" value={payoutModel} onChange={(e) => setPayoutModel(e.target.value as PayoutModel)}>
                      {PAYOUT_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </Field></div>
                  <div className="w-32"><Field label="Value"><input type="number" min={0} step="0.01" className="input" value={payoutValue} onChange={(e) => setPayoutValue(e.target.value)} /></Field></div>
                </div>
              )}
              <div className="mt-3"><Field label="Apply Custom Revenue"><YesNoToggle value={applyCustomRevenue} onChange={setApplyCustomRevenue} /></Field></div>
              {applyCustomRevenue && (
                <div className="ml-3 mt-2 flex max-w-md gap-2 border-l-2 border-border pl-4">
                  <div className="flex-1"><Field label="Revenue *">
                    <select className="input" value={revenueModel} onChange={(e) => setRevenueModel(e.target.value as PayoutModel)}>
                      {PAYOUT_MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </Field></div>
                  <div className="w-32"><Field label="Value"><input type="number" min={0} step="0.01" className="input" value={revenueValue} onChange={(e) => setRevenueValue(e.target.value)} /></Field></div>
                </div>
              )}
            </div>

            <div className="border-t border-border pt-4">
              <PartnersConditionField applyAll={applyAllPartners} onApplyAll={setApplyAllPartners} options={partnerOptions} selected={partnerIds} onChange={setPartnerIds} />
              <label className="mt-3 flex items-center gap-2 text-small text-fg">
                <input type="checkbox" className="chk" checked={firePartnerPostback} onChange={(e) => setFirePartnerPostback(e.target.checked)} />Fire Partner Postback
              </label>
            </div>

            <div className="border-t border-border pt-4">
              <p className="mb-3 text-h3 font-medium text-fg">Offer Conditions</p>
              <div className="flex max-w-2xl gap-3">
                <div className="flex-1"><Field label="Offer *">
                  <select className="input" required value={offerId} onChange={(e) => { setOfferId(e.target.value); setGoalId(''); }}>
                    <option value="">Select Offer…</option>
                    {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.ref != null ? `(${o.ref}) ${o.name}` : o.name}</option>)}
                  </select>
                </Field></div>
                <div className="flex-1"><Field label="Event *">
                  <select className="input" disabled={!offerId} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                    <option value="">Select Event…</option>
                    {(goals ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}{g.isDefault ? ' (default)' : ''}</option>)}
                  </select>
                </Field></div>
              </div>
            </div>
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
