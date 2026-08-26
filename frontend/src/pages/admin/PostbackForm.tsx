/**
 * Add/Edit Postback — full page (Everflow-style), matching the reference's own segmented-control
 * layout and the same "Postback Level" concept the Manage list's "Level" column derives from.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock } from '../../components/ui';
import type { Postback, Publisher, Offer } from '../../types';

const STATUSES = ['active', 'disabled'] as const;
const STATUS_LABEL: Record<string, string> = { active: 'Active', disabled: 'Inactive' };
const STATUS_DOT: Record<string, string> = { active: 'bg-success', disabled: 'bg-warning' };
const TYPES = ['conversion', 'event', 'cpc'] as const;
const TYPE_LABEL: Record<string, string> = { conversion: 'Conversion', event: 'Event', cpc: 'CPC' };
const LEVELS = ['global', 'specific', 'global_offer'] as const;
const LEVEL_LABEL: Record<string, string> = { global: 'Global', specific: 'Specific', global_offer: 'Global (Offer)' };
const DELIVERY_METHODS = ['postback', 'html', 'meta', 'tiktok', 'snapchat', 'rumble'] as const;
const DELIVERY_LABEL: Record<string, string> = { postback: 'Postback', html: 'HTML', meta: 'Meta', tiktok: 'TikTok', snapchat: 'Snapchat', rumble: 'Rumble' };

function Segmented({ options, value, onChange, labels, dots }: { options: readonly string[]; value: string; onChange: (v: string) => void; labels?: Record<string, string>; dots?: Record<string, string> }) {
  return (
    <div className="inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={`flex items-center gap-1.5 px-4 py-2 text-small font-medium transition-colors ${value === o ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
          {dots && <span className={`h-2 w-2 rounded-full ${dots[o] ?? 'bg-fg-muted'}`} />}
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

interface FormState {
  status: string; description: string; postbackType: string; level: string;
  publisherId: string; offerId: string; deliveryMethod: string;
  url: string; method: string; event: string; delay: string; htmlCode: string;
}

const INITIAL: FormState = {
  status: 'active', description: '', postbackType: 'conversion', level: 'global',
  publisherId: '', offerId: '', deliveryMethod: 'postback',
  url: '', method: 'GET', event: '', delay: '', htmlCode: '',
};

export default function PostbackForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading } = useQuery<Postback>(isEdit ? `/api/postbacks/${id}` : null);
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const [form, setForm] = useState<FormState>(INITIAL);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/postbacks', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/postbacks/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  useEffect(() => {
    if (!existing) return;
    setForm({
      status: existing.status, description: existing.description ?? '', postbackType: existing.postbackType,
      level: existing.scope === 'specific' ? 'specific' : existing.scope === 'global_offer' ? 'global_offer' : 'global',
      publisherId: existing.publisherId ?? '', offerId: existing.offerId ?? '', deliveryMethod: existing.deliveryMethod,
      url: existing.url ?? '', method: existing.method, event: existing.event ?? '', delay: existing.delay ?? '', htmlCode: existing.htmlCode ?? '',
    });
  }, [existing]);

  if (isEdit && loading) return <StateBlock><Spinner /></StateBlock>;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      status: form.status, description: form.description || null, postbackType: form.postbackType,
      deliveryMethod: form.deliveryMethod, method: form.method,
      publisherId: form.level === 'global_offer' ? null : (form.publisherId || null),
      offerId: form.level === 'global' ? null : (form.offerId || null),
      event: form.event || null, delay: form.delay || null,
    };
    if (form.deliveryMethod === 'html') body.htmlCode = form.htmlCode;
    else body.url = form.url;
    const res = isEdit ? await update.run(body) : await create.run(body);
    if (res) nav('/app/aff-postbacks');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Postback' : 'Add Postback'} subtitle={`Partners › Postbacks › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-2xl mx-auto">
        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          <div>
            <label className="label mb-2 block">Status *</label>
            <Segmented options={STATUSES} value={form.status} onChange={(v) => set('status', v)} labels={STATUS_LABEL} dots={STATUS_DOT} />
          </div>

          <Field label="Description"><textarea className="input min-h-[70px]" value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>

          <div>
            <label className="label mb-2 block">Postback Type *</label>
            <Segmented options={TYPES} value={form.postbackType} onChange={(v) => set('postbackType', v)} labels={TYPE_LABEL} />
          </div>

          <div>
            <label className="label mb-2 block">Postback Level *</label>
            <Segmented options={LEVELS} value={form.level} onChange={(v) => set('level', v)} labels={LEVEL_LABEL} />
            {(form.level === 'global' || form.level === 'specific') && (
              <div className="mt-3 rounded-card border border-border bg-page p-4">
                <Field label="Partner *">
                  <select className="input" required value={form.publisherId} onChange={(e) => set('publisherId', e.target.value)}>
                    <option value="" disabled>Select Partner…</option>
                    {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              </div>
            )}
            {(form.level === 'specific' || form.level === 'global_offer') && (
              <div className="mt-3 rounded-card border border-border bg-page p-4">
                <Field label="Offer *">
                  <select className="input" required value={form.offerId} onChange={(e) => set('offerId', e.target.value)}>
                    <option value="" disabled>Select Offer…</option>
                    {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </Field>
              </div>
            )}
          </div>

          <Field label="Delivery Method *">
            <select className="input" required value={form.deliveryMethod} onChange={(e) => set('deliveryMethod', e.target.value)}>
              {DELIVERY_METHODS.map((m) => <option key={m} value={m}>{DELIVERY_LABEL[m]}</option>)}
            </select>
          </Field>

          {form.deliveryMethod === 'html' ? (
            <Field label="HTML Code *"><textarea className="input min-h-[140px] font-mono text-tiny" required value={form.htmlCode} onChange={(e) => set('htmlCode', e.target.value)} placeholder="<script>…</script>" /></Field>
          ) : (
            <>
              <Field label="Postback URL *"><input className="input font-mono text-small" required value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://example.com/pb?click_id={click_id}&payout={payout}" /></Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="HTTP Method"><select className="input" value={form.method} onChange={(e) => set('method', e.target.value)}><option>GET</option><option>POST</option></select></Field>
                <Field label="Event"><input className="input" value={form.event} onChange={(e) => set('event', e.target.value)} placeholder="e.g. purchase" /></Field>
                <Field label="Delay"><input className="input" value={form.delay} onChange={(e) => set('delay', e.target.value)} placeholder="e.g. 15 minutes" /></Field>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Link to="/app/aff-postbacks" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
