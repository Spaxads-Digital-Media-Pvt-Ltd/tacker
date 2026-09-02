/**
 * Add/Edit Traffic Blocking — full page matching the reference's Sub ID Filters section (Sub1..
 * Sub10 + Source ID, each a Yes/No toggle that reveals a Match Type select + Value input).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock, Segmented } from '../../components/ui';
import type { Publisher, Offer, TrafficBlocking, TrafficBlockingFieldKey, TrafficBlockingMatchType } from '../../types';

const STATUSES = ['active', 'inactive'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'Active', inactive: 'Inactive' };
const STATUS_DOT: Record<string, string> = { active: 'bg-success', inactive: 'bg-warning' };

const FIELD_KEYS: TrafficBlockingFieldKey[] = ['sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'sub6', 'sub7', 'sub8', 'sub9', 'sub10', 'sourceId'];
const FIELD_LABEL: Record<TrafficBlockingFieldKey, string> = {
  sub1: 'Sub1', sub2: 'Sub2', sub3: 'Sub3', sub4: 'Sub4', sub5: 'Sub5',
  sub6: 'Sub6', sub7: 'Sub7', sub8: 'Sub8', sub9: 'Sub9', sub10: 'Sub10', sourceId: 'Source ID',
};
const MATCH_TYPES: TrafficBlockingMatchType[] = ['begins_with', 'contains', 'does_not_contain', 'does_not_match', 'ends_with', 'exact_match', 'is_empty'];
const MATCH_LABEL: Record<TrafficBlockingMatchType, string> = {
  begins_with: 'Begins With', contains: 'Contains', does_not_contain: 'Does not contain',
  does_not_match: 'Does not match', ends_with: 'Ends With', exact_match: 'Exact Match', is_empty: 'Is Empty',
};

interface FieldState { enabled: boolean; matchType: TrafficBlockingMatchType | ''; value: string }
const emptyFieldState = (): FieldState => ({ enabled: false, matchType: '', value: '' });

interface FormState {
  publisherId: string; status: string; offerId: string;
  fields: Record<TrafficBlockingFieldKey, FieldState>;
}
const INITIAL: FormState = {
  publisherId: '', status: 'active', offerId: '',
  fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, emptyFieldState()])) as Record<TrafficBlockingFieldKey, FieldState>,
};

export default function TrafficBlockingForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading } = useQuery<TrafficBlocking>(isEdit ? `/api/traffic-blocking/${id}` : null);
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const [form, setForm] = useState<FormState>(INITIAL);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/traffic-blocking', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/traffic-blocking/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  useEffect(() => {
    if (!existing) return;
    const fields = Object.fromEntries(FIELD_KEYS.map((k) => {
      const f = existing.filters[k];
      return [k, f ? { enabled: true, matchType: f.matchType, value: f.value ?? '' } : emptyFieldState()];
    })) as Record<TrafficBlockingFieldKey, FieldState>;
    setForm({ publisherId: existing.publisherId, status: existing.status, offerId: existing.offerId, fields });
  }, [existing]);

  if (isEdit && loading) return <StateBlock><Spinner /></StateBlock>;

  const setFieldState = (k: TrafficBlockingFieldKey, next: Partial<FieldState>) =>
    setForm((f) => ({ ...f, fields: { ...f.fields, [k]: { ...f.fields[k], ...next } } }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const filters: Record<string, { matchType: string; value: string | null }> = {};
    for (const k of FIELD_KEYS) {
      const f = form.fields[k];
      if (f.enabled && f.matchType) filters[k] = { matchType: f.matchType, value: f.matchType === 'is_empty' ? null : f.value };
    }
    const body = { publisherId: form.publisherId, offerId: form.offerId, status: form.status, filters };
    const res = isEdit ? await update.run(body) : await create.run(body);
    if (res) nav('/app/aff-traffic-blocking');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Traffic Blocking' : 'Add Traffic Blocking'} subtitle={`Partners › Traffic Blocking › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-2xl mx-auto">
        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          <Field label="Partner *">
            <select className="input" required value={form.publisherId} onChange={(e) => setForm((f) => ({ ...f, publisherId: e.target.value }))}>
              <option value="" disabled>Select Partner…</option>
              {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>

          <div>
            <label className="label mb-2 block">Status *</label>
            <Segmented options={STATUSES} value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))} labels={STATUS_LABEL} dots={STATUS_DOT} />
          </div>

          <Field label="Offer *">
            <select className="input" required value={form.offerId} onChange={(e) => setForm((f) => ({ ...f, offerId: e.target.value }))}>
              <option value="" disabled>Select Offer…</option>
              {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>

          <div className="border-t border-border pt-6">
            <h3 className="mb-4 text-h3 font-medium text-fg">Sub ID Filters</h3>
            <div className="space-y-5">
              {FIELD_KEYS.map((k) => {
                const f = form.fields[k];
                return (
                  <div key={k}>
                    <label className="label mb-1 block">{FIELD_LABEL[k]}</label>
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" role="switch" aria-checked={f.enabled}
                        onClick={() => setFieldState(k, { enabled: !f.enabled })}
                        className={`relative inline-flex h-8 w-16 items-center rounded-full border transition-colors ${f.enabled ? 'border-success bg-success/10 justify-end' : 'border-border bg-surface justify-start'} px-1`}>
                        <span className={`grid h-6 w-6 place-items-center rounded-full text-tiny font-medium shadow ${f.enabled ? 'bg-success text-white' : 'bg-white text-fg-secondary'}`}>
                          {f.enabled ? 'Yes' : 'No'}
                        </span>
                      </button>
                      {f.enabled && (
                        <>
                          <select className="input !w-44" required value={f.matchType} onChange={(e) => setFieldState(k, { matchType: e.target.value as TrafficBlockingMatchType })}>
                            <option value="" disabled>Select Match Type…</option>
                            {MATCH_TYPES.map((m) => <option key={m} value={m}>{MATCH_LABEL[m]}</option>)}
                          </select>
                          {f.matchType && f.matchType !== 'is_empty' && (
                            <input className="input !w-56" required placeholder="Value" value={f.value} onChange={(e) => setFieldState(k, { value: e.target.value })} />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Link to="/app/aff-traffic-blocking" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
