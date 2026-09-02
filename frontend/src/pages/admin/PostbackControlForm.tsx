/**
 * Add/Edit Postback Control — 2-step wizard matching the reference: General (Name, Status,
 * Effective Between, Control Type) then Rules (Set Specific Target, Apply Only to Selected
 * Partners, Build Your Rule(s)). This is real enforcement, not a cosmetic form — see
 * api-backend/src/lib/postback-controls/evaluate.ts for where these rules actually run against
 * live conversions. Rule variables are limited to what's genuinely available at that point (event,
 * payout, revenue, source, sub1-5) — no fabricated fields.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, Search, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock, Segmented } from '../../components/ui';
import type { PostbackControl, PostbackControlRule, PostbackControlVariable, PostbackControlOperator, Offer, Publisher, Advertiser } from '../../types';

const STEPS = ['General', 'Rules'] as const;
const VARIABLE_OPTIONS: { value: PostbackControlVariable; label: string }[] = [
  { value: 'event', label: 'Event' },
  { value: 'payout', label: 'Payout' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'source', label: 'Source (postback/pixel/iframe)' },
  { value: 'sub1', label: 'Sub 1' },
  { value: 'sub2', label: 'Sub 2' },
  { value: 'sub3', label: 'Sub 3' },
  { value: 'sub4', label: 'Sub 4' },
  { value: 'sub5', label: 'Sub 5' },
];
const OPERATOR_OPTIONS: { value: PostbackControlOperator; label: string; needsValue: boolean }[] = [
  { value: 'equals', label: 'Equals', needsValue: true },
  { value: 'not_equals', label: 'Does Not Equal', needsValue: true },
  { value: 'contains', label: 'Contains', needsValue: true },
  { value: 'is_empty', label: 'Is Empty', needsValue: false },
  { value: 'greater_than', label: 'Greater Than', needsValue: true },
  { value: 'less_than', label: 'Less Than', needsValue: true },
];

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
  name: string; status: 'active' | 'inactive'; effectiveMode: 'Always On' | 'Set Specific Period';
  effectiveStart: string; effectiveEnd: string; controlType: 'accept' | 'reject' | 'hold';
  hasTarget: boolean; targetType: 'offer' | 'advertiser'; targetIds: string[];
  hasPartners: boolean; partnerIds: string[];
  conditionLogic: 'all' | 'any'; rules: PostbackControlRule[];
}
const INITIAL: FormState = {
  name: '', status: 'active', effectiveMode: 'Always On', effectiveStart: '', effectiveEnd: '', controlType: 'accept',
  hasTarget: false, targetType: 'offer', targetIds: [], hasPartners: false, partnerIds: [],
  conditionLogic: 'all', rules: [],
};

export default function PostbackControlForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading } = useQuery<PostbackControl>(isEdit ? `/api/postback-controls/${id}` : null);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/postback-controls', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/postback-controls/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name, status: existing.status,
      effectiveMode: existing.effectiveStart || existing.effectiveEnd ? 'Set Specific Period' : 'Always On',
      effectiveStart: existing.effectiveStart ? existing.effectiveStart.slice(0, 10) : '',
      effectiveEnd: existing.effectiveEnd ? existing.effectiveEnd.slice(0, 10) : '',
      controlType: existing.controlType,
      hasTarget: Boolean(existing.targetType), targetType: existing.targetType ?? 'offer', targetIds: existing.targetIds,
      hasPartners: existing.partnerIds.length > 0, partnerIds: existing.partnerIds,
      conditionLogic: existing.conditionLogic, rules: existing.rules,
    });
  }, [existing]);

  const targetOptions = useMemo(() => (form.targetType === 'offer'
    ? (offers ?? []).map((o) => ({ id: o.id, name: o.name }))
    : (advertisers ?? []).map((a) => ({ id: a.id, name: a.name }))), [form.targetType, offers, advertisers]);
  const partnerOptions = useMemo(() => (publishers ?? []).map((p) => ({ id: p.id, name: p.name })), [publishers]);

  if (isEdit && loading) return <StateBlock><Spinner /></StateBlock>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const addRule = () => set('rules', [...form.rules, { variable: 'event', operator: 'equals', value: '' }]);
  const updateRule = (i: number, next: PostbackControlRule) => set('rules', form.rules.map((r, ri) => (ri === i ? next : r)));
  const removeRule = (i: number) => set('rules', form.rules.filter((_, ri) => ri !== i));

  const generalValid = form.name.trim() && (form.effectiveMode === 'Always On' || (form.effectiveStart && form.effectiveEnd));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: form.name, status: form.status,
      effectiveStart: form.effectiveMode === 'Set Specific Period' && form.effectiveStart ? new Date(form.effectiveStart).toISOString() : null,
      effectiveEnd: form.effectiveMode === 'Set Specific Period' && form.effectiveEnd ? new Date(form.effectiveEnd).toISOString() : null,
      controlType: form.controlType,
      targetType: form.hasTarget ? form.targetType : null,
      targetIds: form.hasTarget ? form.targetIds : [],
      partnerIds: form.hasPartners ? form.partnerIds : [],
      conditionLogic: form.conditionLogic,
      rules: form.rules.filter((r) => r.value !== '' || OPERATOR_OPTIONS.find((o) => o.value === r.operator)?.needsValue === false),
    };
    const res = isEdit ? await update.run(body) : await create.run(body);
    if (res) nav('/app/adv-postback-controls');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Postback Control' : 'Add Postback Control'} subtitle={`Advertisers › Postback Controls › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-3">
              <button type="button" onClick={() => i === 0 || generalValid ? setStep(i) : undefined}
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

              <div>
                <label className="label mb-2 block">Effective Between *</label>
                <Segmented options={['Always On', 'Set Specific Period']} value={form.effectiveMode} onChange={(v) => set('effectiveMode', v as FormState['effectiveMode'])} />
                {form.effectiveMode === 'Set Specific Period' && (
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <Field label="Start Date *"><input type="date" className="input" required value={form.effectiveStart} onChange={(e) => set('effectiveStart', e.target.value)} /></Field>
                    <Field label="End Date *"><input type="date" className="input" required min={form.effectiveStart || undefined} value={form.effectiveEnd} onChange={(e) => set('effectiveEnd', e.target.value)} /></Field>
                  </div>
                )}
              </div>

              <div>
                <label className="label mb-2 block">Control Type *</label>
                <p className="mb-2 text-tiny text-fg-secondary">Automatically manage conversions by accepting, rejecting, or putting them on hold based on incoming variables.</p>
                <Segmented options={['accept', 'reject', 'hold']} value={form.controlType} onChange={(v) => set('controlType', v as FormState['controlType'])} dots={{ accept: 'bg-success', reject: 'bg-danger-text', hold: 'bg-warning' }} />
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Link to="/app/adv-postback-controls" className="btn-ghost">Cancel</Link>
                <button type="button" className="btn-primary" disabled={!generalValid} onClick={() => setStep(1)}>Next</button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <label className="label mb-2 block">Set Specific Target</label>
                <p className="mb-2 text-tiny text-fg-secondary">Apply only to selected Offers or Advertisers.</p>
                <YesNoToggle value={form.hasTarget} onChange={(v) => set('hasTarget', v)} />
                {form.hasTarget && (
                  <div className="mt-3 space-y-3 rounded-card border border-border bg-page p-4">
                    <Segmented options={['offer', 'advertiser']} value={form.targetType} onChange={(v) => { set('targetType', v as FormState['targetType']); set('targetIds', []); }} />
                    <MultiSelectPicker label={form.targetType === 'offer' ? 'Offers' : 'Advertisers'} options={targetOptions} selected={form.targetIds} onChange={(ids) => set('targetIds', ids)} />
                  </div>
                )}
              </div>

              <div>
                <label className="label mb-2 block">Apply Only to Selected Partners</label>
                <YesNoToggle value={form.hasPartners} onChange={(v) => set('hasPartners', v)} />
                {form.hasPartners && (
                  <div className="mt-3">
                    <MultiSelectPicker label="Partners" options={partnerOptions} selected={form.partnerIds} onChange={(ids) => set('partnerIds', ids)} />
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-5">
                <h3 className="mb-3 text-h3 font-medium text-fg">Build Your Rule(s)</h3>
                <div>
                  <label className="label mb-2 block">Condition *</label>
                  <Segmented options={['all', 'any']} value={form.conditionLogic} onChange={(v) => set('conditionLogic', v as FormState['conditionLogic'])} />
                  <p className="mt-1 text-tiny text-fg-secondary">{form.conditionLogic === 'all' ? 'All Must Apply' : 'One Or More Must Apply'}</p>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <span className="text-small font-medium text-fg">Set Up Rule(s)</span>
                  <button type="button" title="Add rule" onClick={addRule}
                    className="grid h-7 w-7 place-items-center rounded-full border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg">
                    <Plus size={15} />
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {form.rules.map((rule, i) => {
                    const opDef = OPERATOR_OPTIONS.find((o) => o.value === rule.operator);
                    return (
                      <div key={i} className="flex items-end gap-2 rounded-card border border-border p-3">
                        <Field label="Variable *">
                          <select className="input" value={rule.variable} onChange={(e) => updateRule(i, { ...rule, variable: e.target.value as PostbackControlVariable })}>
                            {VARIABLE_OPTIONS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                          </select>
                        </Field>
                        <Field label="Operator *">
                          <select className="input" value={rule.operator} onChange={(e) => updateRule(i, { ...rule, operator: e.target.value as PostbackControlOperator })}>
                            {OPERATOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </Field>
                        {opDef?.needsValue !== false && (
                          <Field label="Value *"><input className="input" required value={rule.value} onChange={(e) => updateRule(i, { ...rule, value: e.target.value })} /></Field>
                        )}
                        <button type="button" onClick={() => removeRule(i)} title="Remove rule"
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-muted hover:bg-accent-subtle">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                  {form.rules.length === 0 && <p className="text-small text-fg-muted">No rules yet — this control matches every conversion in its target/partner scope. Click + to add a condition.</p>}
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <button type="button" className="btn-ghost" onClick={() => setStep(0)}>Back</button>
                <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
              </div>
            </div>
          )}
        </form>
      </div>
    </>
  );
}
