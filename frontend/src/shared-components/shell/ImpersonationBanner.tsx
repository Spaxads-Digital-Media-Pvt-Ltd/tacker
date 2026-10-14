/**
 * The bar across the top of an impersonation tab (F-10): whose portal this is, that an admin is
 * viewing it (every change is recorded under the admin), when it ends — and the way out.
 */
import { clearSession, type Session } from '../../auth/session';

export function ImpersonationBanner({ session }: { session: Session }) {
  const ends = session.expiresAt
    ? new Date(session.expiresAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const end = () => {
    clearSession();
    window.close();
    window.location.replace('/impersonate?ended=1'); // when the browser keeps the tab open
  };
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning-bg px-4 py-2 text-small text-warning-text">
      <span>
        Viewing the {session.role === 'publisher' ? 'partner' : 'advertiser'} portal as <strong>{session.displayName}</strong>
        {' '}— admin impersonation{ends ? `, ends at ${ends}` : ''}. Anything you change here is recorded under your name.
      </span>
      <button type="button" className="btn-ghost !py-1" onClick={end}>End impersonation</button>
    </div>
  );
}
