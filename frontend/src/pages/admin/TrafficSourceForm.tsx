/**
 * Add/Edit Traffic Source — full page matching the reference: Enable Postback URL toggle (reveals
 * a Postback URL textarea with an "Add Macro" picker), Visible to Partners checkbox, and a dynamic
 * Tracking Link Parameter list (Parameter/Value row pairs, + to add, trash to remove).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HelpCircle, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock } from '../../components/ui';
import type { TrafficSource, TrafficSourceParam } from '../../types';

const MACROS: { token: string; description: string }[] = [
  { token: 'click_id', description: 'The click ID' },
  { token: 'conversion_id', description: 'The conversion ID' },
  { token: 'offer_id', description: 'The offer ID' },
  { token: 'publisher_id', description: 'The partner ID' },
  { token: 'advertiser_id', description: 'The advertiser ID' },
  { token: 'event', description: 'The conversion event name' },
  { token: 'payout', description: 'The payout amount' },
  { token: 'revenue', description: 'The revenue amount' },
  { token: 'currency', description: 'The currency code' },
  { token: 'txn_id', description: 'The transaction ID' },
  { token: 'country', description: 'The click country' },
  { token: 'device', description: 'The click device type' },
  { token: 'sub1', description: 'Sub ID 1 in the partner tracking URL' },
  { token: 'sub2', description: 'Sub ID 2 in the partner tracking URL' },
  { token: 'sub3', description: 'Sub ID 3 in the partner tracking URL' },
  { token: 'sub4', description: 'Sub ID 4 in the partner tracking URL' },
  { token: 'sub5', description: 'Sub ID 5 in the partner tracking URL' },
];

function AddMacroMenu({ onInsert }: { onInsert: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const filtered = MACROS.filter((m) => m.token.toLowerCase().includes(q.toLowerCase()));

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border bg-surface px-3 py-1.5 text-tiny font-medium text-fg hover:bg-accent-subtle">
        {'{ }'} Add Macro
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-card border border-border bg-elevated shadow-elevated">
          <div className="border-b border-border p-2">
            <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.map((m) => (
              <button key={m.token} type="button" onClick={() => { onInsert(m.token); setOpen(false); setQ(''); }}
                className="block w-full px-3 py-1.5 text-left hover:bg-accent-subtle">
                <span className="font-mono text-small text-accent-text">{`{${m.token}}`}</span>
                <p className="text-tiny text-fg-secondary">{m.description}</p>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-3 text-small text-fg-muted">No macros found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const emptyParam = (): TrafficSourceParam => ({ parameter: '', value: '' });

interface FormState {
  name: string; enablePostback: boolean; postbackUrl: string; visibleToPartners: boolean;
  parameters: TrafficSourceParam[];
}
const INITIAL: FormState = { name: '', enablePostback: false, postbackUrl: '', visibleToPartners: false, parameters: [emptyParam()] };

export default function TrafficSourceForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading } = useQuery<TrafficSource>(isEdit ? `/api/traffic-sources/${id}` : null);
  const [form, setForm] = useState<FormState>(INITIAL);
  const postbackRef = useRef<HTMLTextAreaElement>(null);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/traffic-sources', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/traffic-sources/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name, enablePostback: existing.enablePostback, postbackUrl: existing.postbackUrl ?? '',
      visibleToPartners: existing.visibleToPartners, parameters: existing.parameters.length ? existing.parameters : [emptyParam()],
    });
  }, [existing]);

  if (isEdit && loading) return <StateBlock><Spinner /></StateBlock>;

  const insertMacro = (token: string) => {
    const ta = postbackRef.current;
    const insert = `{${token}}`;
    if (!ta) { setForm((f) => ({ ...f, postbackUrl: f.postbackUrl + insert })); return; }
    const start = ta.selectionStart ?? form.postbackUrl.length;
    const end = ta.selectionEnd ?? form.postbackUrl.length;
    const next = form.postbackUrl.slice(0, start) + insert + form.postbackUrl.slice(end);
    setForm((f) => ({ ...f, postbackUrl: next }));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + insert.length, start + insert.length); });
  };

  const setParam = (i: number, next: Partial<TrafficSourceParam>) =>
    setForm((f) => ({ ...f, parameters: f.parameters.map((p, pi) => (pi === i ? { ...p, ...next } : p)) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      name: form.name, enablePostback: form.enablePostback,
      postbackUrl: form.enablePostback ? form.postbackUrl : null,
      visibleToPartners: form.visibleToPartners,
      parameters: form.parameters.filter((p) => p.parameter.trim() && p.value.trim()),
    };
    const res = isEdit ? await update.run(body) : await create.run(body);
    if (res) nav('/app/aff-traffic-sources');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Traffic Source' : 'Add Traffic Source'} subtitle={`Partners › Traffic Sources › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-2xl mx-auto">
        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          <Field label="Name *"><input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="label mb-2 block">Enable Postback URL</label>
              <button type="button" role="switch" aria-checked={form.enablePostback}
                onClick={() => setForm((f) => ({ ...f, enablePostback: !f.enablePostback }))}
                className={`relative inline-flex h-8 w-16 items-center rounded-full border transition-colors ${form.enablePostback ? 'border-success bg-success/10 justify-end' : 'border-border bg-surface justify-start'} px-1`}>
                <span className={`grid h-6 w-6 place-items-center rounded-full text-tiny font-medium shadow ${form.enablePostback ? 'bg-success text-white' : 'bg-white text-fg-secondary'}`}>
                  {form.enablePostback ? 'Yes' : 'No'}
                </span>
              </button>
            </div>
            <div>
              <label className="label mb-2 flex items-center gap-1.5">
                Visible to Partners
                <span title="Partners can see and select this traffic source when generating their own tracking links."><HelpCircle size={13} className="text-fg-muted" /></span>
              </label>
              <input type="checkbox" className="chk" checked={form.visibleToPartners} onChange={(e) => setForm((f) => ({ ...f, visibleToPartners: e.target.checked }))} />
            </div>
          </div>

          {form.enablePostback && (
            <div className="rounded-card border border-border p-4">
              <div className="mb-2 flex items-center justify-between">
                <label className="label">Postback URL *</label>
                <AddMacroMenu onInsert={insertMacro} />
              </div>
              <textarea ref={postbackRef} className="input min-h-[90px] font-mono text-small" required={form.enablePostback}
                placeholder="Example: https://www.example.com/?tid={transaction_id}"
                value={form.postbackUrl} onChange={(e) => setForm((f) => ({ ...f, postbackUrl: e.target.value }))} />
            </div>
          )}

          <div className="border-t border-border pt-6">
            <div className="mb-3 flex items-center justify-between">
              <label className="label">Tracking Link Parameter *</label>
              <button type="button" onClick={() => setForm((f) => ({ ...f, parameters: [...f.parameters, emptyParam()] }))}
                className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg hover:bg-accent-subtle">+</button>
            </div>
            <div className="space-y-3">
              {form.parameters.map((p, i) => (
                <div key={i} className="flex items-end gap-2 rounded-card border border-border p-3">
                  <Field label="Parameter *"><input className="input" required value={p.parameter} onChange={(e) => setParam(i, { parameter: e.target.value })} /></Field>
                  <Field label="Value *"><input className="input" required value={p.value} onChange={(e) => setParam(i, { value: e.target.value })} /></Field>
                  <button type="button" disabled={form.parameters.length === 1}
                    onClick={() => setForm((f) => ({ ...f, parameters: f.parameters.filter((_, pi) => pi !== i) }))}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-muted hover:bg-accent-subtle disabled:cursor-not-allowed disabled:opacity-40">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Link to="/app/aff-traffic-sources" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
