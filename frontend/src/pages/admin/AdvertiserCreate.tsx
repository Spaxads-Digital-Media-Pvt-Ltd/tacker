import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';

/** Advertisers › Create Advertiser — sectioned wizard page. */
export default function AdvertiserCreate() {
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', contactEmail: '', billingTerms: '', status: 'active', defaultCurrency: 'USD' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/advertisers', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { name: form.name, status: form.status, defaultCurrency: form.defaultCurrency };
    if (form.contactEmail) body['contactEmail'] = form.contactEmail;
    if (form.billingTerms) body['billingTerms'] = form.billingTerms;
    const res = await run(body);
    if (res) nav(`/app/advertisers/${res.id}`);
  };

  return (
    <>
      <PageHeader title="Create Advertiser" subtitle="Advertisers › Create"
        action={<button className="btn-ghost" onClick={() => nav('/app/advertisers')}>Cancel</button>} />
      <form onSubmit={submit} className="space-y-6 pb-24">
        {error && <p className="rounded-[var(--radius)] bg-danger-bg px-4 py-3 text-small text-danger-text ">{error}</p>}

        <section className="card">
          <h2 className="font-display text-h3 font-semibold text-fg">Account Information</h2>
          <p className="mb-4 text-small text-fg-secondary">Primary advertiser details and preferences.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Advertiser / website name" /></Field>
            <Field label="Email"><input className="input" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="Primary contact email" /></Field>
          </div>
        </section>

        <section className="card">
          <h2 className="font-display text-h3 font-semibold text-fg">Account Settings</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Account Status *"><select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>{['active', 'pending', 'inactive'].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Currency"><input className="input" maxLength={3} value={form.defaultCurrency} onChange={(e) => set('defaultCurrency', e.target.value.toUpperCase())} /></Field>
            <div />
          </div>
        </section>

        <section className="card">
          <h2 className="font-display text-h3 font-semibold text-fg">Billing</h2>
          <Field label="Billing terms (optional)"><textarea className="input min-h-[80px]" value={form.billingTerms} onChange={(e) => set('billingTerms', e.target.value)} placeholder="Net-30, prepay…" /></Field>
        </section>

        <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-end gap-2 border-t border-border bg-surface/90 px-6 py-3 backdrop-blur md:left-64">
          <button type="button" className="btn-ghost" onClick={() => nav('/app/advertisers')}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create Advertiser'}</button>
        </div>
      </form>
    </>
  );
}
