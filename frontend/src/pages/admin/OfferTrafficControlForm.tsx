/**
 * Offers › Traffic Controls › Add / Edit — matches the reference's real 2-step "Add Traffic
 * Control" wizard (verified live at /offers/trafficcontrols/add): step 1 "General" (Name/Status/
 * Effective Between, an Offer Selection section toggling All vs. specific Offers/Advertisers via
 * the same dual-list picker used by Offer Groups, and a Partner Selection section), step 2
 * "Control" (Control Type, Action, Variables, Comparison Method, and a real "one value per line"
 * Values box).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader, Field, Segmented } from '../../components/ui';
import { useQuery, useMutation } from '../../lib/useApi';
import { api } from '../../lib/api';
import { DualListPicker } from '../../components/DualListPicker';
import { VARIABLES, COMPARISON_METHODS, type TrafficControl } from '../../data/trafficControls';
import type { Advertiser, Offer, Publisher } from '../../types';

export default function OfferTrafficControlForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const { data: existing } = useQuery<TrafficControl>(isEdit ? `/api/traffic-controls/${id}` : null);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [hasPeriod, setHasPeriod] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');

  const [offerSelect, setOfferSelect] = useState(false);
  const [offerScope, setOfferScope] = useState<'offers' | 'advertisers'>('offers');
  const [offerIds, setOfferIds] = useState<string[]>([]);
  const [advertiserIds, setAdvertiserIds] = useState<string[]>([]);

  const [partnerSelect, setPartnerSelect] = useState(false);
  const [partnerIds, setPartnerIds] = useState<string[]>([]);

  const [controlType, setControlType] = useState<'blacklist' | 'whitelist'>('blacklist');
  const [action, setAction] = useState<'block' | 'fail_traffic'>('block');
  const [variables, setVariables] = useState<string[]>([]);
  const [comparisonMethod, setComparisonMethod] = useState('');
  const [valuesText, setValuesText] = useState('');

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setStatus(existing.status === 'deleted' ? 'inactive' : existing.status);
    setHasPeriod(!!(existing.effectiveFrom || existing.effectiveTo));
    setEffectiveFrom(existing.effectiveFrom?.slice(0, 10) ?? '');
    setEffectiveTo(existing.effectiveTo?.slice(0, 10) ?? '');
    setOfferSelect(existing.offerScope !== 'all');
    setOfferScope(existing.offerScope === 'advertisers' ? 'advertisers' : 'offers');
    setOfferIds(existing.offerIds);
    setAdvertiserIds(existing.advertiserIds);
    setPartnerSelect(existing.partnerScope === 'specific');
    setPartnerIds(existing.partnerIds);
    setControlType(existing.controlType);
    setAction(existing.action);
    setVariables(existing.variables);
    setComparisonMethod(existing.comparisonMethod ?? '');
    setValuesText(existing.values.join('\n'));
  }, [existing]);

  const offerOptions = (offers ?? []).map((o) => ({ value: o.id, label: o.ref != null ? `${o.name} (${o.ref})` : o.name, active: o.status === 'active' }));
  const advertiserOptions = (advertisers ?? []).map((a) => ({ value: a.id, label: a.ref != null ? `${a.name} (${a.ref})` : a.name, active: a.status === 'active' }));
  const partnerOptions = (publishers ?? []).map((p) => ({ value: p.id, label: p.ref != null ? `${p.name} (${p.ref})` : p.name, active: p.status === 'active' }));

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/traffic-controls/${id}`, body) : api.post('/api/traffic-controls', body));

  const method = COMPARISON_METHODS.find((m) => m.value === comparisonMethod);

  const submit = async () => {
    const body: Record<string, unknown> = {
      name, status, action, controlType, variables,
      comparisonMethod: comparisonMethod || null,
      values: method?.value === 'is_empty' ? [] : valuesText.split('\n').map((v) => v.trim()).filter(Boolean),
      effectiveFrom: hasPeriod && effectiveFrom ? new Date(effectiveFrom).toISOString() : null,
      effectiveTo: hasPeriod && effectiveTo ? new Date(effectiveTo).toISOString() : null,
      offerScope: !offerSelect ? 'all' : offerScope,
      offerIds: offerSelect && offerScope === 'offers' ? offerIds : [],
      advertiserIds: offerSelect && offerScope === 'advertisers' ? advertiserIds : [],
      partnerScope: partnerSelect ? 'specific' : 'all',
      partnerIds: partnerSelect ? partnerIds : [],
    };
    const res = await run(body);
    if (res !== null) nav('/app/offers-traffic-controls');
  };

  const step1Valid = name.trim() && (!offerSelect || (offerScope === 'offers' ? offerIds.length > 0 : advertiserIds.length > 0)) && (!partnerSelect || partnerIds.length > 0);
  const step2Valid = variables.length > 0 && comparisonMethod && (method?.value === 'is_empty' || valuesText.trim());

  return (
    <>
      <PageHeader title={isEdit ? `Edit Traffic Control${existing ? `: ${existing.name}` : ''}` : 'Add Traffic Control'} subtitle={`Offers › Traffic Controls › ${isEdit ? 'Edit' : 'Add'}`} />

      <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-6 border-b border-border pb-4">
        {(['General', 'Control'] as const).map((label, i) => {
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

      <div className="card space-y-6">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

        {step === 1 ? (
          <>
            <div>
              <h3 className="mb-4 text-h3 font-medium text-fg">General</h3>
              <div className="max-w-md space-y-4">
                <Field label="Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Status *">
                  <Segmented options={['active', 'inactive']} value={status}
                    onChange={(v) => setStatus(v as typeof status)}
                    dots={{ active: 'bg-success', inactive: 'bg-warning' }} />
                </Field>
                <Field label="Effective Between *">
                  <Segmented
                    options={[{ value: 'always', label: 'Always On' }, { value: 'period', label: 'Set Specific Period' }]}
                    value={hasPeriod ? 'period' : 'always'}
                    onChange={(v) => setHasPeriod(v === 'period')} />
                </Field>
                {hasPeriod && (
                  <div className="ml-3 flex gap-3 border-l-2 border-border pl-4">
                    <Field label="From"><input type="date" className="input" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></Field>
                    <Field label="To"><input type="date" className="input" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} /></Field>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="mb-4 text-h3 font-medium text-fg">Offer Selection</h3>
              <Field label="Apply to specific offers or advertisers">
                <button type="button" onClick={() => setOfferSelect((v) => !v)}
                  className={`flex w-24 items-center rounded-full border border-border p-0.5 text-tiny font-medium ${offerSelect ? 'justify-end bg-accent-subtle text-accent-text' : 'justify-start text-fg-secondary'}`}>
                  <span className="rounded-full bg-surface px-2 py-1 shadow-sm">{offerSelect ? 'Yes' : 'No'}</span>
                </button>
              </Field>
              {offerSelect && (
                <div className="mt-4 max-w-2xl">
                  <div className="mb-3">
                    <Segmented options={['offers', 'advertisers']} value={offerScope} onChange={(v) => setOfferScope(v as typeof offerScope)} />
                  </div>
                  {offerScope === 'offers'
                    ? <DualListPicker options={offerOptions} selected={offerIds} onChange={setOfferIds} />
                    : <DualListPicker options={advertiserOptions} selected={advertiserIds} onChange={setAdvertiserIds} />}
                </div>
              )}
            </div>

            <div className="border-t border-border pt-6">
              <h3 className="mb-4 text-h3 font-medium text-fg">Partner Selection</h3>
              <Field label="Apply to specific partner(s)">
                <button type="button" onClick={() => setPartnerSelect((v) => !v)}
                  className={`flex w-24 items-center rounded-full border border-border p-0.5 text-tiny font-medium ${partnerSelect ? 'justify-end bg-accent-subtle text-accent-text' : 'justify-start text-fg-secondary'}`}>
                  <span className="rounded-full bg-surface px-2 py-1 shadow-sm">{partnerSelect ? 'Yes' : 'No'}</span>
                </button>
              </Field>
              {partnerSelect && <div className="mt-4 max-w-2xl"><DualListPicker options={partnerOptions} selected={partnerIds} onChange={setPartnerIds} /></div>}
            </div>
          </>
        ) : (
          <div className="max-w-md space-y-4">
            <Field label="Control Type *">
              <Segmented options={['whitelist', 'blacklist']} value={controlType} onChange={(v) => setControlType(v as typeof controlType)} />
            </Field>
            <Field label="Action *">
              <Segmented
                options={[{ value: 'block', label: 'Block' }, { value: 'fail_traffic', label: 'Fail Traffic' }]}
                value={action} onChange={(v) => setAction(v as typeof action)} />
            </Field>
            <Field label="Variables *">
              <select multiple className="input h-32" value={variables} onChange={(e) => setVariables(Array.from(e.target.selectedOptions, (o) => o.value))}>
                {VARIABLES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Comparison Method *">
              <select className="input" value={comparisonMethod} onChange={(e) => setComparisonMethod(e.target.value)}>
                <option value="">Select Comparison Method…</option>
                {COMPARISON_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}{m.max ? ` (${m.max} max)` : ''}</option>)}
              </select>
            </Field>
            {method && method.value !== 'is_empty' && (
              <Field label="Values *">
                <textarea className="input min-h-[120px]" placeholder="Enter one value per line" value={valuesText} onChange={(e) => setValuesText(e.target.value)} />
                <p className="mt-1 text-tiny text-fg-secondary">{valuesText.split('\n').filter((v) => v.trim()).length} / {method.max} value(s) entered</p>
              </Field>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          {step === 1 ? (
            <>
              <button type="button" className="btn-ghost" onClick={() => nav('/app/offers-traffic-controls')}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!step1Valid} onClick={() => setStep(2)}>Next</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="btn-primary" disabled={busy || !step2Valid} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
            </>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
