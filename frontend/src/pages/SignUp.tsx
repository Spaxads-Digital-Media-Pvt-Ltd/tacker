import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { publicNetwork, signUp, type PublicNetwork, type SignUpResult } from '../auth/authClient';
import { AuthError } from '../shared-components/primitives/AuthCard';
import { Brandmark } from '../shared-components/primitives/Brandmark';

/**
 * Self-serve sign-up (signed out) — /pub-signup?network=<slug> for partners, /adv-signup?network=<slug>
 * for advertisers. The network decides whether it takes sign-ups (Control Center › Platform); a closed or
 * unknown one says so instead of showing the form. The applicant never picks a password: the network's
 * login details are emailed, which proves the inbox is theirs. New accounts wait in Pending unless the
 * network auto-approves.
 */
export default function SignUp({ kind }: { kind: 'partner' | 'advertiser' }) {
  const [params] = useSearchParams();
  const slug = (params.get('network') ?? '').trim();
  const [net, setNet] = useState<PublicNetwork | null>(null);
  const [loadError, setLoadError] = useState<string | null>(slug ? null : 'This sign-up link is missing its network. Ask the network for its sign-up link.');
  const [f, setF] = useState({ name: '', contactName: '', email: '', website: '', trafficSource: '', country: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SignUpResult | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const who = kind === 'partner' ? 'partner' : 'advertiser';

  useEffect(() => {
    if (!slug) return;
    let live = true;
    publicNetwork(slug).then((n) => { if (live) setNet(n); }).catch((e) => { if (live) setLoadError(e instanceof Error ? e.message : 'Unknown network.'); });
    return () => { live = false; };
  }, [slug]);

  const open = net ? (kind === 'partner' ? net.partnerSignup : net.advertiserSignup) : false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setDone(await signUp(kind, {
        network: slug, name: f.name.trim(), email: f.email.trim(),
        ...(f.contactName.trim() ? { contactName: f.contactName.trim() } : {}), ...(f.website.trim() ? { website: f.website.trim() } : {}),
        ...(kind === 'partner' && f.trafficSource.trim() ? { trafficSource: f.trafficSource.trim() } : {}),
        ...(f.country.trim() ? { country: f.country.trim() } : {}),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const loginHref = slug ? `/login?network=${encodeURIComponent(slug)}` : '/login';
  return (
    <div className="grid min-h-full place-items-center bg-page p-6">
      <div className="w-full max-w-xl animate-fade-in">
        <div className="mb-8 flex justify-center">{net?.logoUrl ? <img src={net.logoUrl} alt={net.name} className="h-10" /> : <Brandmark />}</div>
        <div className="card !p-8">
          {loadError ? (
            <>
              <h1 className="text-h1 font-bold tracking-tight text-fg">Sign up</h1>
              <AuthError>{loadError}</AuthError>
            </>
          ) : !net ? (
            <p className="text-small text-fg-secondary">Loading…</p>
          ) : !open ? (
            <>
              <h1 className="text-h1 font-bold tracking-tight text-fg">{net.name}</h1>
              <p className="mt-2 text-small text-fg-secondary">{net.name} isn’t taking {who} sign-ups right now. Ask the network for an invite.</p>
              <Link to={loginHref} className="btn-ghost mt-6 inline-flex">Back to sign in</Link>
            </>
          ) : done ? (
            <>
              <h1 className="text-h1 font-bold tracking-tight text-fg">{done.status === 'active' ? 'You’re in' : 'Application received'}</h1>
              <p className="mt-2 text-small text-fg-secondary">{done.message}</p>
              {done.status === 'pending' && <p className="mt-2 text-small text-fg-secondary">{net.name} reviews new {who}s — you can sign in now; your account becomes active once it’s approved.</p>}
              {done.credentials && (
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-[var(--radius)] bg-page px-3 py-2 text-tiny">
                  <dt className="text-fg-secondary">Email</dt><dd className="font-mono">{done.credentials.email}</dd>
                  <dt className="text-fg-secondary">Temporary password</dt><dd className="font-mono">{done.credentials.temporaryPassword}</dd>
                </dl>
              )}
              <Link to={loginHref} className="btn-primary mt-6 inline-flex">Sign in</Link>
            </>
          ) : (
            <>
              <h1 className="text-h1 font-bold tracking-tight text-fg">Become {kind === 'partner' ? 'a partner' : 'an advertiser'} of {net.name}</h1>
              <p className="mt-1.5 text-small text-fg-secondary">We’ll email your login details to the address below.</p>
              {error && <AuthError>{error}</AuthError>}
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div><label className="label" htmlFor="s-name">Company name</label><input id="s-name" className="input" required maxLength={200} value={f.name} onChange={set('name')} autoComplete="organization" /></div>
                  <div><label className="label" htmlFor="s-contact">Your name</label><input id="s-contact" className="input" maxLength={200} value={f.contactName} onChange={set('contactName')} autoComplete="name" /></div>
                  <div><label className="label" htmlFor="s-email">Email</label><input id="s-email" className="input" type="email" required maxLength={200} value={f.email} onChange={set('email')} autoComplete="email" /></div>
                  <div><label className="label" htmlFor="s-web">Website</label><input id="s-web" className="input" maxLength={300} value={f.website} onChange={set('website')} placeholder="https://" autoComplete="url" /></div>
                  {kind === 'partner' && <div><label className="label" htmlFor="s-traffic">Main traffic source</label><input id="s-traffic" className="input" maxLength={200} value={f.trafficSource} onChange={set('trafficSource')} placeholder="e.g. SEO, email, social" /></div>}
                  <div><label className="label" htmlFor="s-country">Country</label><input id="s-country" className="input" maxLength={100} value={f.country} onChange={set('country')} autoComplete="country-name" /></div>
                </div>
                <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Sign up'}</button>
              </form>
              <p className="mt-4 text-center text-tiny text-fg-secondary">Already have an account? <Link to={loginHref} className="font-medium text-accent-text hover:underline">Sign in</Link></p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
