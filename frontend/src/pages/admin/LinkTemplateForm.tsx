/**
 * Add/Edit Link Template — matches the reference: Name, Advertiser, and a Landing Page URL textarea
 * with an "Add Macro" picker (same macro set as Traffic Sources' postback URL builder).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Spinner, StateBlock } from '../../components/ui';
import type { LinkTemplate, Advertiser } from '../../types';

const MACROS: { token: string; description: string }[] = [
  { token: 'click_id', description: 'The click ID' },
  { token: 'advertiser_id', description: 'The advertiser ID' },
  { token: 'offer_id', description: 'The offer ID' },
  { token: 'publisher_id', description: 'The partner ID' },
  { token: 'sub1', description: 'Sub ID 1 in the partner tracking URL' },
  { token: 'sub2', description: 'Sub ID 2 in the partner tracking URL' },
  { token: 'sub3', description: 'Sub ID 3 in the partner tracking URL' },
  { token: 'sub4', description: 'Sub ID 4 in the partner tracking URL' },
  { token: 'sub5', description: 'Sub ID 5 in the partner tracking URL' },
  { token: 'source_id', description: 'Traffic source ID' },
  { token: 'country', description: 'The click country' },
  { token: 'device', description: 'The click device type' },
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

interface FormState { name: string; advertiserId: string; destinationUrl: string }
const INITIAL: FormState = { name: '', advertiserId: '', destinationUrl: '' };

export default function LinkTemplateForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const nav = useNavigate();
  const { data: existing, loading } = useQuery<LinkTemplate>(isEdit ? `/api/link-templates/${id}` : null);
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const [form, setForm] = useState<FormState>(INITIAL);
  const urlRef = useRef<HTMLTextAreaElement>(null);
  const create = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/link-templates', body));
  const update = useMutation((body: Record<string, unknown>) => api.patch<{ id: string }>(`/api/link-templates/${id}`, body));
  const { busy, error } = isEdit ? update : create;

  useEffect(() => {
    if (!existing) return;
    setForm({ name: existing.name, advertiserId: existing.advertiserId, destinationUrl: existing.destinationUrl });
  }, [existing]);

  if (isEdit && loading) return <StateBlock><Spinner /></StateBlock>;

  const insertMacro = (token: string) => {
    const ta = urlRef.current;
    const insert = `{${token}}`;
    if (!ta) { setForm((f) => ({ ...f, destinationUrl: f.destinationUrl + insert })); return; }
    const start = ta.selectionStart ?? form.destinationUrl.length;
    const end = ta.selectionEnd ?? form.destinationUrl.length;
    const next = form.destinationUrl.slice(0, start) + insert + form.destinationUrl.slice(end);
    setForm((f) => ({ ...f, destinationUrl: next }));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + insert.length, start + insert.length); });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { name: form.name, advertiserId: form.advertiserId, destinationUrl: form.destinationUrl };
    const res = isEdit ? await update.run(body) : await create.run(body);
    if (res) nav('/app/adv-link-templates');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Link Template' : 'Add Link Template'} subtitle={`Advertisers › Link Templates › ${isEdit ? 'Edit' : 'Add'}`} />
      <div className="max-w-2xl mx-auto">
        <form onSubmit={submit} className="card space-y-6">
          {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
          <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

          <Field label="Name *">
            <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>

          <Field label="Advertiser *">
            <select className="input" required value={form.advertiserId} onChange={(e) => setForm((f) => ({ ...f, advertiserId: e.target.value }))}>
              <option value="">Select Advertiser…</option>
              {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="label">Landing Page URL *</label>
              <AddMacroMenu onInsert={insertMacro} />
            </div>
            <textarea ref={urlRef} className="input min-h-[90px] font-mono text-small" required
              placeholder="https://example.com/?clientid={advertiser_id}&transaction_id={sub1}"
              value={form.destinationUrl} onChange={(e) => setForm((f) => ({ ...f, destinationUrl: e.target.value }))} />
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Link to="/app/adv-link-templates" className="btn-ghost">Cancel</Link>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
