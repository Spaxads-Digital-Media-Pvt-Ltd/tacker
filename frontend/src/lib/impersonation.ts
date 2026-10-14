/**
 * Admin impersonation (F-10): POST /api/{publishers|advertisers}/:id/impersonate returns a 30-minute
 * token for that account's portal. It opens in a NEW TAB as that tab's own session
 * (pages/Impersonate.tsx), so the admin's sign-in everywhere else is untouched.
 */
import { useState } from 'react';
import { api } from './api';
import { useMutation } from './useApi';

const POPUP_BLOCKED = 'Your browser blocked the new tab. Allow pop-ups for this site, then click Impersonate again.';

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
