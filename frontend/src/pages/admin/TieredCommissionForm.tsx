/**
 * Add/Edit Tiered Commission — 2-step wizard matching the reference: General (Name, Status, Notes,
 * Start/End Date, Targeted Entity Type + selection, Partner scoping) then Settings (Time Period,
 * Goals/rules, Payout/Revenue Setting, Retroactive Mode). Real enforcement, not cosmetic — see
 * api-backend/src/lib/tiered-commissions/evaluate.ts for where these rules actually adjust live
 * conversion payout/revenue. Goal variables are limited to what this app can honestly compute
 * (conversion count, total payout, total revenue) — no fabricated metrics.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, Search, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock } from '../../components/ui';
import type { TieredCommission, TieredGoal, TieredVariable, TieredAction, TimePeriod, Offer, Publisher, Advertiser } from '../../types';

const STEPS = ['General', 'Settings'] as const;
const TIME_PERIOD_OPTIONS: { value: TimePeriod; label: string }[] = [
  { value: 'daily', label: 'Daily' }, { value: 'global', label: 'Global' }, { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' }, { value: 'weekly', label: 'Weekly' },
];
const VARIABLE_OPTIONS: { value: TieredVariable; label: string }[] = [
  { value: 'conversion', label: 'Conversion' }, { value: 'total_payout', label: 'Total Payout' }, { value: 'total_revenue', label: 'Total Revenue' },
];
const ACTION_OPTIONS: { value: TieredAction; label: string; unit: string }[] = [
  { value: 'decrease_flat', label: 'Decrease (Flat Amount)', unit: '$' },
  { value: 'decrease_pct', label: 'Decrease (Percentage)', unit: '%' },
  { value: 'increase_flat', label: 'Increase (Flat Amount)', unit: '$' },
  { value: 'increase_pct', label: 'Increase (Percentage)', unit: '%' },
];

function Segmented({ options, value, onChange, dots }: { options: readonly string[]; value: string; onChange: (v: string) => void; dots?: Record<string, string> }) {
  return (
    <div className="inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={`flex items-center gap-1.5 px-4 py-2 text-small font-medium transition-colors ${value === o ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
          {dots && <span className={`h-2 w-2 rounded-full ${dots[o] ?? 'bg-fg-muted'}`} />}
          {o}
        </button>
      ))}
    </div>
  );
}

function YesNoToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)}
      className={`relative inline-flex h-8 w-16 items-center rounded-full border transition-colors ${value ? 'border-success bg-success/10 justify-end' : 'border-border bg-surface justify-start'} px-1`}>
      <span className={`grid h-6 w-6 place-items-center rounded-full text-tiny font-medium shadow ${value ? 'bg-success text-white' : 'bg-white text-fg-secondary'}`}>
        {value ? 'Yes' : 'No'}
      </span>
    </button>
  );
}

function MultiSelectPicker({
  label, options, selected, onChange,
}: { label: string; options: { id: string; name: string }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const available = options.filter((o) => !selected.includes(o.id) && o.name.toLowerCase().includes(q.toLowerCase()));
  const selectedItems = selected.map((id) => options.find((o) => o.id === id)).filter((o): o is { id: string; name: string } => Boolean(o));

  return (
    <div className="rounded-card border border-border p-3">
      <div className="relative mb-2">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input className="input !pl-8" placeholder={`Search ${label}…`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q && (
        <div className="mb-2 max-h-40 overflow-y-auto rounded-[var(--radius)] border border-border">
          {available.slice(0, 50).map((o) => (
            <button key={o.id} type="button" onClick={() => { onChange([...selected, o.id]); setQ(''); }}
              className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
              {o.name}
            </button>
          ))}
          {available.length === 0 && <p className="px-3 py-2 text-small text-fg-muted">No matches.</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {selectedItems.map((o) => (
          <span key={o.id} className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2.5 py-1 text-tiny font-medium text-accent-text">
            {o.name}
            <button type="button" onClick={() => onChange(selected.filter((id) => id !== o.id))} className="text-accent-text/70 hover:text-accent-text"><X size={11} /></button>
          </span>
        ))}
        {selectedItems.length === 0 && <span className="text-tiny text-fg-muted">None selected.</span>}
      </div>
    </div>
  );
}

interface FormState {
  name: string; status: 'active' | 'inactive'; notes: string;
  hasStart: boolean; effectiveStart: string; hasEnd: boolean; effectiveEnd: string;
  targetType: 'offer' | 'advertiser'; targetIds: string[];
  hasPartners: boolean; partnerIds: string[];
  timePeriod: TimePeriod | ''; goals: TieredGoal[];
  payoutEnabled: boolean; payoutAction: TieredAction | ''; payoutValue: string;
  revenueEnabled: boolean; revenueAction: TieredAction | ''; revenueValue: string;
  retroactiveMode: 'disabled' | 'enabled' | 'custom';
}
const INITIAL: FormState = {
  name: '', status: 'active', notes: '', hasStart: false, effectiveStart: '', hasEnd: false, effectiveEnd: '',
  targetType: 'offer', targetIds: [], hasPartners: false, partnerIds: [],
  timePeriod: '', goals: [], payoutEnabled: false, payoutAction: '', payoutValue: '',
  revenueEnabled: false, revenueAction: '', revenueValue: '', retroactiveMode: 'disabled',
};

export default function TieredCommissionForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading } = useQuery<TieredCommission>(isEdit ? `/api/tiered-commissions/${id}` : null);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/tiered-commissions', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/tiered-commissions/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name, status: existing.status, notes: existing.notes ?? '',
      hasStart: Boolean(existing.effectiveStart), effectiveStart: existing.effectiveStart ? existing.effectiveStart.slice(0, 10) : '',
      hasEnd: Boolean(existing.effectiveEnd), effectiveEnd: existing.effectiveEnd ? existing.effectiveEnd.slice(0, 10) : '',
      targetType: existing.targetType, targetIds: existing.targetIds,
      hasPartners: existing.partnerIds.length > 0, partnerIds: existing.partnerIds,
      timePeriod: existing.timePeriod, goals: existing.goals,
      payoutEnabled: existing.payoutEnabled, payoutAction: existing.payoutAction ?? '', payoutValue: existing.payoutValue ?? '',
      revenueEnabled: existing.revenueEnabled, revenueAction: existing.revenueAction ?? '', revenueValue: existing.revenueValue ?? '',
      retroactiveMode: existing.retroactiveMode,
    });
  }, [existing]);

  const targetOptions = useMemo(() => (form.targetType === 'offer'
    ? (offers ?? []).map((o) => ({ id: o.id, name: o.name }))
    : (advertisers ?? []).map((a) => ({ id: a.id, name: a.name }))), [form.targetType, offers, advertisers]);
  const partnerOptions = useMemo(() => (publishers ?? []).map((p) => ({ id: p.id, name: p.name })), [publishers]);

  if (isEdit && loading) return <StateBlock><Spinner /></StateBlock>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const addGoal = () => set('goals', [...form.goals, { variable: 'conversion', minValue: 0, maxValue: null }]);
  const updateGoal = (i: number, next: TieredGoal) => set('goals', form.goals.map((g, gi) => (gi === i ? next : g)));
  const removeGoal = (i: number) => set('goals', form.goals.filter((_, gi) => gi !== i));

  const generalValid = form.name.trim() && form.targetIds.length > 0 && (!form.hasPartners || form.partnerIds.length > 0)
    && (!form.hasStart || form.effectiveStart) && (!form.hasEnd || form.effectiveEnd);
  const settingsValid = form.timePeriod && form.goals.length > 0
    && (!form.payoutEnabled || (form.payoutAction && form.payoutValue !== ''))
    && (!form.revenueEnabled || (form.revenueAction && form.revenueValue !== ''));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: form.name, status: form.status, notes: form.notes || null,
      effectiveStart: form.hasStart && form.effectiveStart ? new Date(form.effectiveStart).toISOString() : null,
      effectiveEnd: form.hasEnd && form.effectiveEnd ? new Date(form.effectiveEnd).toISOString() : null,
      targetType: form.targetType, targetIds: form.targetIds,
      partnerIds: form.hasPartners ? form.partnerIds : [],
      timePeriod: form.timePeriod || undefined,
      retroactiveMode: form.retroactiveMode,
      goals: form.goals,
      payoutEnabled: form.payoutEnabled, payoutAction: form.payoutEnabled ? form.payoutAction || null : null,
      payoutValue: form.payoutEnabled && form.payoutValue !== '' ? Number(form.payoutValue) : null,
      revenueEnabled: form.revenueEnabled, revenueAction: form.revenueEnabled ? form.revenueAction || null : null,
      revenueValue: form.revenueEnabled && form.revenueValue !== '' ? Number(form.revenueValue) : null,
    };
    const res = isEdit ? await update.run(body) : await create.run(body);
    if (res) nav('/app/adv-tiered-commissions');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Tiered Commission' : 'Add Tiered Commission'} subtitle={`Advertisers › Tiered Commissions › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-3">
              <button type="button" onClick={() => (i === 0 || generalValid) && setStep(i)}
                className={`flex items-center gap-2 text-small font-medium ${step === i ? 'text-accent-text' : 'text-fg-secondary'}`}>
                <span className={`grid h-6 w-6 place-items-center rounded-full text-tiny ${step === i ? 'bg-accent-text text-white' : 'border border-border'}`}>{i + 1}</span>
                {s}
              </button>
              {i < STEPS.length - 1 && <div className="h-px w-12 bg-border" />}
            </div>
          ))}
        </div>

        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          {step === 0 && (
            <div className="space-y-5">
              <Field label="Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
              <div>
                <label className="label mb-2 block">Status *</label>
                <Segmented options={['active', 'inactive']} value={form.status} onChange={(v) => set('status', v as FormState['status'])} dots={{ active: 'bg-success', inactive: 'bg-warning' }} />
              </div>
              <Field label="Notes"><textarea className="input min-h-[60px]" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Field>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <label className="label mb-2 block">Enable Start Date</label>
                  <div className="flex items-center gap-2">
                    <YesNoToggle value={form.hasStart} onChange={(v) => set('hasStart', v)} />
                    {form.hasStart && <input type="date" className="input" value={form.effectiveStart} onChange={(e) => set('effectiveStart', e.target.value)} />}
                  </div>
                </div>
                <div>
                  <label className="label mb-2 block">Enable End Date</label>
                  <div className="flex items-center gap-2">
                    <YesNoToggle value={form.hasEnd} onChange={(v) => set('hasEnd', v)} />
                    {form.hasEnd && <input type="date" className="input" min={form.effectiveStart || undefined} value={form.effectiveEnd} onChange={(e) => set('effectiveEnd', e.target.value)} />}
                  </div>
                </div>
              </div>

              <div>
                <label className="label mb-2 block">Targeted Entity Type *</label>
                <Segmented options={['offer', 'advertiser']} value={form.targetType} onChange={(v) => { set('targetType', v as FormState['targetType']); set('targetIds', []); }} />
                <div className="mt-3">
                  <MultiSelectPicker label={form.targetType === 'offer' ? 'Offers' : 'Advertisers'} options={targetOptions} selected={form.targetIds} onChange={(ids) => set('targetIds', ids)} />
                </div>
                {form.targetIds.length === 0 && <p className="mt-1 text-tiny text-danger-text">Select at least one {form.targetType}.</p>}
              </div>

              <div>
                <label className="label mb-2 block">Apply to specific Affiliates</label>
                <YesNoToggle value={form.hasPartners} onChange={(v) => set('hasPartners', v)} />
                {form.hasPartners && (
                  <div className="mt-3">
                    <MultiSelectPicker label="Partners" options={partnerOptions} selected={form.partnerIds} onChange={(ids) => set('partnerIds', ids)} />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Link to="/app/adv-tiered-commissions" className="btn-ghost">Cancel</Link>
                <button type="button" className="btn-primary" disabled={!generalValid} onClick={() => setStep(1)}>Next</button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="mb-3 text-h3 font-medium text-fg">Frequency</h3>
                <Field label="Time Period *">
                  <select className="input" required value={form.timePeriod} onChange={(e) => set('timePeriod', e.target.value as TimePeriod)}>
                    <option value="">Select Time Period…</option>
                    {TIME_PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-small font-medium text-fg">Goals *</span>
                  <button type="button" title="Add goal" onClick={addGoal}
                    className="grid h-7 w-7 place-items-center rounded-full border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg">
                    <Plus size={15} />
                  </button>
                </div>
                <div className="space-y-3">
                  {form.goals.map((goal, i) => (
                    <div key={i} className="rounded-card border border-border p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Variable *">
                              <select className="input" value={goal.variable} onChange={(e) => updateGoal(i, { ...goal, variable: e.target.value as TieredVariable })}>
                                {VARIABLE_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                              </select>
                            </Field>
                            <Field label="Min Value *">
                              <input type="number" min={0} className="input" required value={goal.minValue} onChange={(e) => updateGoal(i, { ...goal, minValue: Number(e.target.value) })} />
                            </Field>
                          </div>
                          <div>
                            <label className="label mb-2 block">Add Upper Bound</label>
                            <div className="flex items-center gap-2">
                              <YesNoToggle value={goal.maxValue != null} onChange={(v) => updateGoal(i, { ...goal, maxValue: v ? goal.minValue + 1 : null })} />
                              {goal.maxValue != null && (
                                <input type="number" min={goal.minValue} className="input !w-32" value={goal.maxValue} onChange={(e) => updateGoal(i, { ...goal, maxValue: Number(e.target.value) })} />
                              )}
                            </div>
                          </div>
                        </div>
                        <button type="button" onClick={() => removeGoal(i)} title="Remove goal"
                          className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-muted hover:bg-accent-subtle">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {form.goals.length === 0 && <p className="text-small text-fg-muted">No goals yet. Click + to add a threshold.</p>}
                </div>
              </div>

              <div className="border-t border-border pt-5">
                <h3 className="mb-3 text-h3 font-medium text-fg">Revenue &amp; Payout</h3>
                <div className="space-y-4">
                  <div>
                    <label className="label mb-2 block">Enable Payout Setting</label>
                    <YesNoToggle value={form.payoutEnabled} onChange={(v) => set('payoutEnabled', v)} />
                    {form.payoutEnabled && (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <Field label="Action *">
                          <select className="input" required value={form.payoutAction} onChange={(e) => set('payoutAction', e.target.value as TieredAction)}>
                            <option value="">Select Action…</option>
                            {ACTION_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                          </select>
                        </Field>
                        <Field label={`payout by ${ACTION_OPTIONS.find((a) => a.value === form.payoutAction)?.unit ?? ''} *`}>
                          <input type="number" min={0} className="input" required value={form.payoutValue} onChange={(e) => set('payoutValue', e.target.value)} />
                        </Field>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="label mb-2 block">Enable Revenue Setting</label>
                    <YesNoToggle value={form.revenueEnabled} onChange={(v) => set('revenueEnabled', v)} />
                    {form.revenueEnabled && (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <Field label="Action *">
                          <select className="input" required value={form.revenueAction} onChange={(e) => set('revenueAction', e.target.value as TieredAction)}>
                            <option value="">Select Action…</option>
                            {ACTION_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                          </select>
                        </Field>
                        <Field label={`revenue by ${ACTION_OPTIONS.find((a) => a.value === form.revenueAction)?.unit ?? ''} *`}>
                          <input type="number" min={0} className="input" required value={form.revenueValue} onChange={(e) => set('revenueValue', e.target.value)} />
                        </Field>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="label mb-2 flex items-center gap-1 block">Retroactive Mode *</label>
                    <Segmented options={['disabled', 'enabled', 'custom']} value={form.retroactiveMode} onChange={(v) => set('retroactiveMode', v as FormState['retroactiveMode'])} />
                    {form.retroactiveMode !== 'disabled' && (
                      <p className="mt-1 text-tiny text-fg-secondary">Only "Disabled" semantics are enforced in this app — the setting is saved for reference, but this conversion and future ones are what actually get adjusted; already-recorded conversions are never rewritten.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <button type="button" className="btn-ghost" onClick={() => setStep(0)}>Back</button>
                <button type="submit" className="btn-primary" disabled={busy || !settingsValid}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
              </div>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
