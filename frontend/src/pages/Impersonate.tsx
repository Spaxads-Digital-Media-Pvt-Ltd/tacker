/**
 * Admin impersonation, start and end (F-10). "Impersonate" on a partner / advertiser — or Super Admin ›
 * Networks › "Open dashboard" (a support session as the network's admin) — opens this page in a new tab
 * with the 30-minute token in the URL fragment (never sent to a server, and wiped from the address bar
 * here). It becomes THIS tab's session (sessionStorage — the admin's own sign-in in other tabs is
 * untouched) and the portal / dashboard opens, under a banner. `?ended=…` is where an ended or expired
 * session lands.
 */
import { useEffect, useState } from 'react';
import { Brandmark } from '../shared-components/primitives/Brandmark';
import { Spinner } from '../shared-components/primitives/ui';
import { startImpersonation, type Session } from '../auth/session';
import { ROLE_HOME } from '../auth/roles';
import { api } from '../lib/api';

interface Claims { kind?: string; network_id?: string; owner_id?: string; impersonated_by?: string; exp?: number; support?: string }
interface Me { impersonation: { account: string | null; adminEmail: string | null } | null }

function claimsOf(token: string): Claims | null {
  try {
    const part = token.split('.')[1] ?? '';
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Claims;
  } catch {
    return null;
  }
}

type State = 'starting' | 'invalid' | 'ended' | 'expired';

export default function Impersonate() {
  const [state, setState] = useState<State>('starting');

  useEffect(() => {
    const ended = new URLSearchParams(window.location.search).get('ended');
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, '', '/impersonate'); // never leave the token in the address bar
    if (ended) { setState(ended === 'expired' ? 'expired' : 'ended'); return; }

    const c = token ? claimsOf(token) : null;
    const support = c?.kind === 'admin' && c.support === 'platform';
    const kind = c?.kind === 'publisher' || c?.kind === 'advertiser' ? c.kind : support ? 'admin' as const : null;
    if (!token || !c || !kind || !c.network_id || (!support && !c.owner_id) || !c.exp || c.exp * 1000 <= Date.now()) {
      setState('invalid');
      return;
    }
    const session: Session = {
      token, role: kind, displayName: support ? 'Network' : kind === 'publisher' ? 'Partner' : 'Advertiser', email: '',
      networkId: c.network_id, ownerId: support ? null : c.owner_id ?? null, expiresAt: c.exp, impersonatedBy: c.impersonated_by ?? 'admin',
      ...(support ? { supportSession: true as const } : {}),
    };
    startImpersonation(session);
    // Name the account (or network) in the header and the banner before it opens.
    void api.get<Me>('/api/me').then((me) => {
      const imp = me.impersonation;
      if (imp?.account) {
        startImpersonation({ ...session, displayName: imp.account, email: imp.adminEmail ? `${support ? 'Super Admin' : 'Viewed by'} ${imp.adminEmail}` : '' });
      }
    }).catch(() => undefined).finally(() => { window.location.replace(ROLE_HOME[kind]); });
  }, []);

  const closeTab = () => { window.close(); };
  const message: Record<Exclude<State, 'starting'>, { title: string; body: string }> = {
    invalid: { title: 'This impersonation link is not valid', body: 'It may have expired (they last 30 minutes) or been copied incompletely. Start it again — from the account’s Impersonate menu, or Super Admin › Networks › Open dashboard.' },
    ended: { title: 'Impersonation ended', body: 'You can close this tab. Your own sign-in in other tabs was not affected.' },
    expired: { title: 'The impersonation session has expired', body: 'It lasts 30 minutes. Start it again — from the account’s Impersonate menu, or Super Admin › Networks › Open dashboard — if you need more time.' },
  };

  return (
    <div className="grid min-h-full place-items-center bg-page p-6">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-8 flex justify-center"><Brandmark /></div>
        <div className="card !p-8">
          {state === 'starting' ? (
            <div className="flex items-center gap-3 text-small text-fg-secondary"><Spinner /> Opening…</div>
          ) : (
            <>
              <h1 className="text-h1 font-bold tracking-tight text-fg">{message[state].title}</h1>
              <p className="mt-3 text-small text-fg-secondary">{message[state].body}</p>
              <button type="button" className="btn-ghost mt-6 w-full" onClick={closeTab}>Close this tab</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
