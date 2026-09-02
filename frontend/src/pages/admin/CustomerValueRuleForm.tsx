/**
 * Customer Value › Payout & Revenue Rules — Add/Edit wizard. Field-for-field structure matches
 * the reference's own real documented flow (General → Timeframe → Behavior; Scope/Conversion
 * Event Grouping; Goal Cycle Recurring vs Continuous; condition builder against Custom Data
 * Points; Outcome Frequency + Custom Payout). Every field here persists for real and is genuinely
 * evaluated against live conversions (api-backend/src/lib/customer-value/evaluate.ts).
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader, Field, Spinner, StateBlock, Segmented } from '../../components/ui';
import { Stepper } from '../../components/Stepper';
import { useQuery, useMutation } from '../../lib/useApi';
import { api } from '../../lib/api';
import type { Offer, Publisher, Advertiser } from '../../types';

const STEPS = ['General', 'Timeframe', 'Behavior'];

interface DataPoint { id: string; name: string; dataType: 'text' | 'number'; parameterKey: string }
interface Condition { dataPointId: string; conditionLogic: 'any_value' | 'sum_of_values'; operator: string; value: string }
interface RuleDetail {
  id: string; name: string; status: string; conversionEventGrouping: string;
  applyOffersMode: string; applyOfferIds: string[];
  applyAdvertisersMode: string; applyAdvertiserIds: string[];
  applyPartnersMode: string; applyPartnerIds: string[];
  startDate: string | null; endDate: string | null;
  goalCycle: string; recurringDuration: string | null; continuousMode: string | null; continuousDays: number | null;
  setGoalConditions: boolean; conditions: Condition[];
  outcomeFrequency: string; payoutValue: string | null; revenueValue: string | null;
}

const TEXT_OPERATORS = [{ value: 'exact_match', label: 'Exact Match' }];
const NUMBER_OPERATORS = [
  { value: 'greater_than', label: 'Greater Than' },
  { value: 'greater_than_or_equal_to', label: 'Greater Than or Equal To' },
  { value: 'less_than', label: 'Less Than' },
  { value: 'less_than_or_equal_to', label: 'Less Than or Equal To' },
  { value: 'equal_to', label: 'Equal To' },
];

function CheckboxList({ items, selected, onChange }: { items: { id: string; name: string }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--radius)] border border-border p-2">
      {items.length === 0 && <p className="text-tiny text-fg-muted">None available.</p>}
      {items.map((item) => (
        <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-small text-fg hover:bg-page">
          <input type="checkbox" className="chk" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /> {item.name}
        </label>
      ))}
    </div>
  );
}

export default function CustomerValueRuleForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const isEdit = Boolean(id);
  const { data: existing, loading: loadingExisting } = useQuery<RuleDetail>(isEdit ? `/api/customer-value/rules/${id}` : null);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: dataPoints } = useQuery<DataPoint[]>('/api/customer-value/data-points');

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('active');
  const [grouping, setGrouping] = useState('all_together');
  const [applyAdvertisersMode, setApplyAdvertisersMode] = useState('all');
  const [applyAdvertiserIds, setApplyAdvertiserIds] = useState<string[]>([]);
  const [applyOffersMode, setApplyOffersMode] = useState('all');
  const [applyOfferIds, setApplyOfferIds] = useState<string[]>([]);
  const [applyPartnersMode, setApplyPartnersMode] = useState('all');
  const [applyPartnerIds, setApplyPartnerIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [goalCycle, setGoalCycle] = useState('continuous');
  const [recurringDuration, setRecurringDuration] = useState('monthly');
  const [continuousMode, setContinuousMode] = useState('for_rule_duration');
  const [continuousDays, setContinuousDays] = useState('365');
  const [setGoalConditions, setSetGoalConditions] = useState(false);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [outcomeFrequency, setOutcomeFrequency] = useState('once_per_customer');
  const [payoutValue, setPayoutValue] = useState('');
  const [revenueValue, setRevenueValue] = useState('');

  useEffect(() => {
    if (!existing) return;
    setName(existing.name); setStatus(existing.status); setGrouping(existing.conversionEventGrouping);
    setApplyAdvertisersMode(existing.applyAdvertisersMode); setApplyAdvertiserIds(existing.applyAdvertiserIds);
    setApplyOffersMode(existing.applyOffersMode); setApplyOfferIds(existing.applyOfferIds);
    setApplyPartnersMode(existing.applyPartnersMode); setApplyPartnerIds(existing.applyPartnerIds);
    setStartDate(existing.startDate ?? ''); setEndDate(existing.endDate ?? '');
    setGoalCycle(existing.goalCycle); setRecurringDuration(existing.recurringDuration ?? 'monthly');
    setContinuousMode(existing.continuousMode ?? 'for_rule_duration'); setContinuousDays(String(existing.continuousDays ?? 365));
    setSetGoalConditions(existing.setGoalConditions); setConditions(existing.conditions);
    setOutcomeFrequency(existing.outcomeFrequency);
    setPayoutValue(existing.payoutValue != null ? String(existing.payoutValue) : '');
    setRevenueValue(existing.revenueValue != null ? String(existing.revenueValue) : '');
  }, [existing]);

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/customer-value/rules/${id}`, body) : api.post('/api/customer-value/rules', body));

  const addCondition = () => {
    if (!dataPoints || dataPoints.length === 0) return;
    const dp = dataPoints[0];
    if (!dp) return;
    setConditions((c) => [...c, { dataPointId: dp.id, conditionLogic: 'any_value', operator: dp.dataType === 'text' ? 'exact_match' : 'greater_than', value: '' }]);
  };
  const updateCondition = (i: number, patch: Partial<Condition>) => setConditions((c) => c.map((cond, idx) => idx === i ? { ...cond, ...patch } : cond));
  const removeCondition = (i: number) => setConditions((c) => c.filter((_, idx) => idx !== i));

  const save = async () => {
    const body = {
      name, status, conversionEventGrouping: grouping,
      applyAdvertisersMode, applyAdvertiserIds: applyAdvertisersMode === 'specific' ? applyAdvertiserIds : [],
      applyOffersMode, applyOfferIds: applyOffersMode === 'specific' ? applyOfferIds : [],
      applyPartnersMode, applyPartnerIds: applyPartnersMode === 'specific' ? applyPartnerIds : [],
      startDate: startDate || null, endDate: endDate || null,
      goalCycle, recurringDuration: goalCycle === 'recurring' ? recurringDuration : null,
      continuousMode: goalCycle === 'continuous' ? continuousMode : null,
      continuousDays: goalCycle === 'continuous' && continuousMode === 'from_first_conversion' ? Number(continuousDays) : null,
      setGoalConditions, conditions: setGoalConditions ? conditions : [],
      outcomeFrequency,
      payoutValue: payoutValue ? Number(payoutValue) : null,
      revenueValue: revenueValue ? Number(revenueValue) : null,
    };
    const res = await run(body);
    if (res) nav('/app/customer-value');
  };

  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : save());

  if (isEdit && loadingExisting) return <StateBlock><Spinner /></StateBlock>;

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Rule' : 'Add Rule'} subtitle="Customer Value › Payout & Revenue Rules" />
      <Stepper steps={STEPS} current={step} />
      <div className="max-w-2xl mx-auto">
        <div className="card">
          <p className="mb-4 text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
          {error && <p className="mb-4 text-small text-danger-text">{error}</p>}

          {step === 0 && (
            <div className="space-y-5">
              <h3 className="text-h3 font-medium text-fg">Basic Details</h3>
              <Field label="Name *"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <div>
                <label className="label mb-2 block">Status *</label>
                <Segmented options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} value={status} onChange={setStatus} />
              </div>

              <h3 className="text-h3 font-medium text-fg">Scope</h3>
              <p className="text-small text-fg-secondary">Choose how the rule applies to your Customer's Conversion Events.</p>
              <div>
                <label className="label mb-2 block">Conversion Events Grouping *</label>
                <Segmented options={[{ value: 'all_together', label: 'All Together' }, { value: 'separately_by', label: 'Separately By' }]} value={grouping} onChange={setGrouping} />
              </div>

              <p className="font-semibold text-fg">Apply Rule To</p>
              <div>
                <label className="label mb-2 block">Advertisers *</label>
                <Segmented options={[{ value: 'all', label: 'All' }, { value: 'specific', label: 'Specific' }]} value={applyAdvertisersMode} onChange={setApplyAdvertisersMode} />
                {applyAdvertisersMode === 'specific' && <div className="mt-2"><CheckboxList items={advertisers ?? []} selected={applyAdvertiserIds} onChange={setApplyAdvertiserIds} /></div>}
              </div>
              <div>
                <label className="label mb-2 block">Offers *</label>
                <Segmented options={[{ value: 'all', label: 'All' }, { value: 'specific', label: 'Specific' }]} value={applyOffersMode} onChange={setApplyOffersMode} />
                {applyOffersMode === 'specific' && <div className="mt-2"><CheckboxList items={offers ?? []} selected={applyOfferIds} onChange={setApplyOfferIds} /></div>}
              </div>
              <div>
                <label className="label mb-2 block">Partners *</label>
                <Segmented options={[{ value: 'all', label: 'All' }, { value: 'specific', label: 'Specific' }]} value={applyPartnersMode} onChange={setApplyPartnersMode} />
                {applyPartnersMode === 'specific' && <div className="mt-2"><CheckboxList items={publishers ?? []} selected={applyPartnerIds} onChange={setApplyPartnerIds} /></div>}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <h3 className="text-h3 font-medium text-fg">Rule Duration</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Start Date"><input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
                <Field label="End Date"><input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
              </div>
              <h3 className="text-h3 font-medium text-fg">Goal Cycle</h3>
              <Segmented options={[{ value: 'continuous', label: 'Continuous' }, { value: 'recurring', label: 'Recurring' }]} value={goalCycle} onChange={setGoalCycle} />
              {goalCycle === 'recurring' ? (
                <Field label="Recurring Duration">
                  <select className="input" value={recurringDuration} onChange={(e) => setRecurringDuration(e.target.value)}>
                    {['daily', 'weekly', 'monthly', 'quarterly'].map((d) => <option key={d} value={d} className="capitalize">{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </Field>
              ) : (
                <>
                  <Segmented options={[{ value: 'from_first_conversion', label: 'From First Conversion' }, { value: 'for_rule_duration', label: 'For Rule Duration' }]} value={continuousMode} onChange={setContinuousMode} />
                  {continuousMode === 'from_first_conversion' && (
                    <Field label="Duration (days)"><input type="number" min={1} className="input" value={continuousDays} onChange={(e) => setContinuousDays(e.target.value)} /></Field>
                  )}
                </>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h3 className="text-h3 font-medium text-fg">Set Goal Conditions</h3>
              <Segmented options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} value={setGoalConditions ? 'yes' : 'no'} onChange={(v) => setSetGoalConditions(v === 'yes')} />

              {setGoalConditions && (
                <div className="space-y-3">
                  {conditions.map((cond, i) => {
                    const dp = dataPoints?.find((d) => d.id === cond.dataPointId);
                    const ops = dp?.dataType === 'number' ? NUMBER_OPERATORS : TEXT_OPERATORS;
                    return (
                      <div key={i} className="grid grid-cols-1 gap-2 rounded-[var(--radius)] border border-border p-3 sm:grid-cols-[1.4fr_1fr_1.2fr_0.8fr_auto]">
                        <select className="input" value={cond.dataPointId} onChange={(e) => {
                          const next = dataPoints?.find((d) => d.id === e.target.value);
                          updateCondition(i, { dataPointId: e.target.value, operator: next?.dataType === 'text' ? 'exact_match' : 'greater_than' });
                        }}>
                          {(dataPoints ?? []).map((d) => <option key={d.id} value={d.id}>{d.name} ({d.dataType})</option>)}
                        </select>
                        <select className="input" value={cond.conditionLogic} onChange={(e) => updateCondition(i, { conditionLogic: e.target.value as Condition['conditionLogic'] })}>
                          <option value="any_value">Any Value</option>
                          <option value="sum_of_values" disabled={dp?.dataType !== 'number'}>Sum of Values</option>
                        </select>
                        <select className="input" value={cond.operator} onChange={(e) => updateCondition(i, { operator: e.target.value })}>
                          {ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input className="input" placeholder="Value" value={cond.value} onChange={(e) => updateCondition(i, { value: e.target.value })} />
                        <button type="button" className="grid place-items-center rounded p-2 text-fg-secondary hover:bg-danger-subtle hover:text-danger-text" onClick={() => removeCondition(i)}><Trash2 size={14} /></button>
                      </div>
                    );
                  })}
                  <button type="button" className="btn-ghost inline-flex items-center gap-1.5" onClick={addCondition} disabled={!dataPoints || dataPoints.length === 0}>
                    <Plus size={14} /> Condition
                  </button>
                  {(!dataPoints || dataPoints.length === 0) && <p className="text-tiny text-fg-muted">Create a Custom Data Point first.</p>}
                </div>
              )}

              <h3 className="text-h3 font-medium text-fg">Goal Achievement Outcome</h3>
              <Field label="Outcome Frequency">
                <Segmented options={[{ value: 'once_per_customer', label: 'Once per Customer' }, { value: 'every_cycle', label: 'Every Cycle' }]} value={outcomeFrequency} onChange={setOutcomeFrequency} />
              </Field>
              <p className="text-small text-fg-secondary">Set a Custom Payout and/or a Custom Revenue — at least one is required. Either overrides the conversion's normal value when this rule fires.</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Custom Payout ($)"><input className="input" value={payoutValue} onChange={(e) => setPayoutValue(e.target.value)} placeholder="200.00" /></Field>
                <Field label="Custom Revenue ($)"><input className="input" value={revenueValue} onChange={(e) => setRevenueValue(e.target.value)} placeholder="200.00" /></Field>
              </div>
            </div>
          )}

          <div className="mt-8 flex justify-between gap-2 border-t border-border pt-4">
            <button className="btn-ghost" onClick={() => nav('/app/customer-value')}>Cancel</button>
            <div className="flex gap-2">
              {step > 0 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
              <button className="btn-primary" disabled={busy || !name || (step === STEPS.length - 1 && !payoutValue && !revenueValue)} onClick={next}>
                {busy ? 'Saving…' : step === STEPS.length - 1 ? 'Save' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
