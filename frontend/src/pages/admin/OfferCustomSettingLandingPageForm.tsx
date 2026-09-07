/**
 * Offers › Custom Settings › Landing Pages › Add / Edit — matches the reference's real 3-step
 * "Add Custom Landing Page" wizard (verified live at /offers/customsettings/landingpages/add):
 * "General" (Name/Status, Apply to specific partner(s) + dual-list, Offer*, Effective Between, Set
 * Parameter Goal), "Targeting" (reduced honest subset), "Landing Pages" (a Landing Page URL textarea
 * with an Add Macro helper — reuses the same MACROS list Creatives already exposes).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Braces } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';
import { EffectiveBetweenField, PartnersConditionField, StatusToggle, TargetingStep, YesNoToggle } from '../../components/CustomSettingFields';
import { MACROS } from '../../data/creatives';
import type { CustomSetting, Targeting } from '../../data/offerCustomSettings';
import type { Offer, Publisher } from '../../types';

export default function OfferCustomSettingLandingPageForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const { data: existing } = useQuery<CustomSetting>(isEdit ? `/api/offer-custom-settings/${id}` : null);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [applyAllPartners, setApplyAllPartners] = useState(true);
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [offerId, setOfferId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [setParameterGoal, setSetParameterGoal] = useState(false);
  const [targeting, setTargeting] = useState<Targeting>({});
  const [url, setUrl] = useState('');
  const urlRef = useRef<HTMLTextAreaElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (existing && !hydrated.current) {
      hydrated.current = true;
      setName(existing.name ?? '');
      setStatus(existing.status === 'inactive' ? 'inactive' : 'active');
      setApplyAllPartners(existing.applyAllPartners);
      setPartnerIds(existing.partnerIds);
      setOfferId(existing.offerId);
      setEffectiveFrom(existing.effectiveFrom ? existing.effectiveFrom.slice(0, 16) : '');
      setEffectiveTo(existing.effectiveTo ? existing.effectiveTo.slice(0, 16) : '');
      setSetParameterGoal(existing.setParameterGoal);
      setTargeting(existing.targeting ?? {});
      setUrl(existing.landingPageUrl ?? '');
    }
  }, [existing]);

  const partnerOptions = (publishers ?? []).map((p) => ({ value: p.id, label: p.ref != null ? `(${p.ref}) ${p.name}` : p.name, active: p.status === 'active' }));

  const insertMacro = (token: string) => {
    const ta = urlRef.current;
    if (!ta) { setUrl((u) => u + token); return; }
    const start = ta.selectionStart ?? url.length;
    const end = ta.selectionEnd ?? url.length;
    setUrl(url.slice(0, start) + token + url.slice(end));
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + token.length; });
  };

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/offer-custom-settings/${id}`, body) : api.post('/api/offer-custom-settings', body));

  const step1Valid = !!name && (applyAllPartners || partnerIds.length > 0) && !!offerId;

  const submit = async () => {
    const body = {
      category: 'landing_pages', name, status, applyAllPartners, partnerIds: applyAllPartners ? [] : partnerIds,
      offerId, effectiveFrom: effectiveFrom || null, effectiveTo: effectiveTo || null,
      setParameterGoal, targeting, landingPageUrl: url,
    };
    const res = await run(body);
    if (res !== null) nav('/app/offers-custom-settings');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Custom Landing Page' : 'Add Custom Landing Page'} subtitle="Offers › Custom Settings › Landing Pages" />

      <div className="mb-6 flex items-center gap-6 border-b border-border pb-4">
        {(['General', 'Targeting', 'Landing Pages'] as const).map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
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
            <PartnersConditionField applyAll={applyAllPartners} onApplyAll={setApplyAllPartners} options={partnerOptions} selected={partnerIds} onChange={setPartnerIds} />
            <div className="max-w-md"><Field label="Offer *">
              <select className="input" required value={offerId} onChange={(e) => setOfferId(e.target.value)}>
                <option value="">Select Offer…</option>
                {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.ref != null ? `(${o.ref}) ${o.name}` : o.name}</option>)}
              </select>
            </Field></div>
            <EffectiveBetweenField from={effectiveFrom} to={effectiveTo} onChange={(f, t) => { setEffectiveFrom(f); setEffectiveTo(t); }} />
            <Field label="Set Parameter Goal"><YesNoToggle value={setParameterGoal} onChange={setSetParameterGoal} /></Field>
          </div>
        ) : step === 2 ? (
          <TargetingStep value={targeting} onChange={setTargeting} />
        ) : (
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center justify-between">
              <label className="label">Landing Page URL *</label>
              <div className="group relative">
                <button type="button" className="flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-2 py-1 text-tiny font-medium text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Braces size={12} /> Add Macro</button>
                <div className="invisible absolute right-0 z-10 mt-1 w-48 rounded-card border border-border bg-surface p-1 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100">
                  {MACROS.map((m) => (
                    <button key={m.token} type="button" onClick={() => insertMacro(m.token)} className="flex w-full items-center justify-between rounded-[var(--radius)] px-2 py-1.5 text-left text-small text-fg-secondary hover:bg-page hover:text-fg">
                      {m.label}<span className="font-mono text-tiny text-fg-muted">{m.token}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <textarea ref={urlRef} className="input min-h-[110px] font-mono text-small" placeholder="Example: https://www.example.com/?tid={click_id}" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        {step === 1 ? (
          <>
            <button type="button" className="btn-ghost" onClick={() => nav('/app/offers-custom-settings')}>Cancel</button>
            <button type="button" className="btn-primary" disabled={!step1Valid} onClick={() => setStep(2)}>Next</button>
          </>
        ) : step === 2 ? (
          <>
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button type="button" className="btn-primary" onClick={() => setStep(3)}>Next</button>
          </>
        ) : (
          <>
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>Back</button>
            <button type="button" className="btn-primary" disabled={!url || busy} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </>
        )}
      </div>
    </>
  );
}
