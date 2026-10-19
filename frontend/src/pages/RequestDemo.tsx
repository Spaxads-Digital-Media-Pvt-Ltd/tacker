import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { requestDemo } from '../auth/authClient';
import { AuthError } from '../shared-components/primitives/AuthCard';
import { Brandmark } from '../shared-components/primitives/Brandmark';
import { BRAND } from '../config/branding';

/**
 * "Request a demo" (signed out): a prospective network asks the platform's sales team for a call. It lands in
 * Super Admin › Sales as a lead routed to a sales member. The hidden `website_url` field is a honeypot.
 */
export default function RequestDemo() {
  const [f, setF] = useState({ name: '', email: '', company: '', phone: '', website: '', country: '', monthlyClicks: '', message: '', website_url: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const clicks = f.monthlyClicks.replace(/[,\s]/g, '');
    if (clicks && !/^\d+$/.test(clicks)) { setError('Monthly clicks must be a whole number, e.g. 2000000.'); return; }
    setBusy(true);
    try {
      await requestDemo({
        name: f.name.trim(), email: f.email.trim(), company: f.company.trim(),
        ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), ...(f.website.trim() ? { website: f.website.trim() } : {}),
        ...(f.country.trim() ? { country: f.country.trim() } : {}), ...(clicks ? { monthlyClicks: Number(clicks) } : {}),
        ...(f.message.trim() ? { message: f.message.trim() } : {}), ...(f.website_url ? { website_url: f.website_url } : {}),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center bg-page p-6">
      <div className="w-full max-w-xl animate-fade-in">
        <div className="mb-8 flex justify-center"><Brandmark /></div>
        <div className="card !p-8">
          {sent ? (
            <>
              <h1 className="text-h1 font-bold tracking-tight text-fg">Thanks — we’ll be in touch</h1>
              <p className="mt-2 text-small text-fg-secondary">Our team will contact you at <strong className="text-fg">{f.email.trim()}</strong> within one business day to set up your {BRAND.name} demo.</p>
              <Link to="/login" className="btn-ghost mt-6 inline-flex">Back to sign in</Link>
            </>
          ) : (
            <>
              <h1 className="text-h1 font-bold tracking-tight text-fg">Request a demo</h1>
              <p className="mt-1.5 text-small text-fg-secondary">Tell us about your network — we’ll show you {BRAND.name} on your own offers and set up a trial.</p>
              {error && <AuthError>{error}</AuthError>}
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div><label className="label" htmlFor="d-name">Your name</label><input id="d-name" className="input" required maxLength={200} value={f.name} onChange={set('name')} autoComplete="name" /></div>
                  <div><label className="label" htmlFor="d-email">Work email</label><input id="d-email" className="input" type="email" required maxLength={200} value={f.email} onChange={set('email')} autoComplete="email" /></div>
                  <div><label className="label" htmlFor="d-company">Company</label><input id="d-company" className="input" required maxLength={200} value={f.company} onChange={set('company')} autoComplete="organization" /></div>
                  <div><label className="label" htmlFor="d-website">Website</label><input id="d-website" className="input" maxLength={300} value={f.website} onChange={set('website')} placeholder="your-network.com" /></div>
                  <div><label className="label" htmlFor="d-phone">Phone</label><input id="d-phone" className="input" maxLength={50} value={f.phone} onChange={set('phone')} autoComplete="tel" /></div>
                  <div><label className="label" htmlFor="d-country">Country</label><input id="d-country" className="input" maxLength={100} value={f.country} onChange={set('country')} autoComplete="country-name" /></div>
                </div>
                <div><label className="label" htmlFor="d-clicks">Clicks per month (roughly)</label><input id="d-clicks" className="input" inputMode="numeric" value={f.monthlyClicks} onChange={set('monthlyClicks')} placeholder="e.g. 5,000,000" /></div>
                <div><label className="label" htmlFor="d-msg">What would you like to see?</label><textarea id="d-msg" className="input min-h-[90px]" maxLength={3000} value={f.message} onChange={set('message')} placeholder="Your verticals, how many offers and partners, the tracker you use today…" /></div>
                {/* Honeypot: hidden from people; bots fill it. */}
                <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <label htmlFor="d-hp">Website URL</label><input id="d-hp" tabIndex={-1} autoComplete="off" value={f.website_url} onChange={set('website_url')} />
                </div>
                <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Sending…' : 'Request a demo'}</button>
              </form>
              <p className="mt-5 text-center text-tiny text-fg-muted">Already a customer? <Link to="/login" className="font-medium text-accent-text hover:underline">Sign in</Link></p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
