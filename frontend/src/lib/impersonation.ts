/**
 * Admin impersonation (F-10): POST /api/{publishers|advertisers}/:id/impersonate returns a 30-minute
 * token for that account's portal. It opens in a NEW TAB as that tab's own session
 * (pages/Impersonate.tsx), so the admin's sign-in everywhere else is untouched.
 */
import { useState } from 'react';
import { api } from './api';
import { useMutation } from './useApi';

const popupBlocked = (button: string) => `Your browser blocked the new tab. Allow pop-ups for this site, then click ${button} again.`;
const POPUP_BLOCKED = popupBlocked('Impersonate');

export function useImpersonate(kind: 'publisher' | 'advertiser', id: string) {
  const m = useMutation(() => api.post<{ token: string }>(`/api/${kind === 'publisher' ? 'publishers' : 'advertisers'}/${id}/impersonate`, {}));
  const [blocked, setBlocked] = useState(false);
  const start = async () => {
    // Opened inside the click, so popup blockers allow it; pointed at the session once the token is
    // back. A blocked tab stops here — no token is issued for a session nobody can open.
    setBlocked(false);
    const tab = window.open('about:blank', '_blank');
    if (!tab) { setBlocked(true); return; }
    const res = await m.run(undefined);
    if (!res) { tab.close(); return; }
    tab.opener = null;
    tab.location.href = `/impersonate#token=${encodeURIComponent(res.token)}`;
  };
  return { start, busy: m.busy, error: blocked ? POPUP_BLOCKED : m.error };
}

/**
 * Super Admin › "Open dashboard": POST /platform/networks/:id/support-session returns a 30-minute token
 * acting as that network's admin — opened like an impersonation, in a new tab of its own.
 */
export function useSupportSession() {
  const m = useMutation((networkId: string) => api.post<{ token: string }>(`/platform/networks/${networkId}/support-session`, {}));
  const [blocked, setBlocked] = useState(false);
  const start = async (networkId: string) => {
    setBlocked(false);
    const tab = window.open('about:blank', '_blank');
    if (!tab) { setBlocked(true); return; }
    const res = await m.run(networkId);
    if (!res) { tab.close(); return; }
    tab.opener = null;
    tab.location.href = `/impersonate#token=${encodeURIComponent(res.token)}`;
  };
  return { start, busy: m.busy, error: blocked ? popupBlocked('Open dashboard') : m.error };
}
