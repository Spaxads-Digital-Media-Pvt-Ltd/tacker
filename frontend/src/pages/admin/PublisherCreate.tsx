import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';

/** Affiliates › Create Affiliate — sectioned wizard page (Identity / Account / Contact). */
export default function PublisherCreate() {
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', contactEmail: '', trafficSource: '', payoutTerms: '', status: 'pending', currency: 'USD' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/publishers', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { name: form.name, status: form.status };
    if (form.contactEmail) body['contactEmail'] = form.contactEmail;
    if (form.trafficSource) body['trafficSource'] = form.trafficSource;
    if (form.payoutTerms) body['payoutTerms'] = form.payoutTerms;
    const res = await run(body);
    if (res) nav(`/app/publishers/${res.id}`);
  };

  return (
    <>
      <PageHeader title="Create Affiliate" subtitle="Affiliates › Create"
        action={<button className="btn-ghost" onClick={() => nav('/app/publishers')}>Cancel</button>} />
      <form onSubmit={submit} className="space-y-6 pb-24">
        {error && <p className="rounded-[var(--radius)] bg-danger-bg px-4 py-3 text-small text-danger-text ">{error}</p>}

        <section className="card">
          <h2 className="font-display text-h3 font-semibold text-fg">Identity</h2>
          <p className="mb-4 text-small text-fg-secondary">The affiliate's name and primary contact.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full Name *"><input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="The name of your affiliate" /></Field>
            <Field label="Email"><input className="input" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="Primary contact email" /></Field>
          </div>
        </section>

        <section className="card">
          <h2 className="font-display text-h3 font-semibold text-fg">Account Settings</h2>
          <p className="mb-4 text-small text-fg-secondary">Status, currency and traffic details.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Account Status *"><select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>{['active', 'pending', 'inactive'].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Currency"><input className="input" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
            <Field label="Traffic source"><input className="input" value={form.trafficSource} onChange={(e) => set('trafficSource', e.target.value)} placeholder="Push, Native, Social…" /></Field>
          </div>
        </section>

        <section className="card">
          <h2 className="font-display text-h3 font-semibold text-fg">Payout Terms</h2>
          <Field label="Payout terms (optional)"><textarea className="input min-h-[80px]" value={form.payoutTerms} onChange={(e) => set('payoutTerms', e.target.value)} placeholder="Net-30, minimum $50…" /></Field>
        </section>

        <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-end gap-2 border-t border-border bg-surface/90 px-6 py-3 backdrop-blur md:left-64">
          <button type="button" className="btn-ghost" onClick={() => nav('/app/publishers')}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create Affiliate'}</button>
        </div>
      </form>
    </>
  );
}
