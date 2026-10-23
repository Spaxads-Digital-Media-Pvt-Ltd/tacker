import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Brandmark } from './Brandmark';

/** The centred card the signed-out screens use (forgot / reset / first-sign-in password). Only the
 * wrapper animates (card-in starts at 0.6 opacity), so the inputs are usable from the first frame. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center bg-page px-4 py-8 sm:p-6">
      <div className="w-full min-w-0 max-w-sm animate-card-in motion-reduce:animate-none">
        <div className="mb-8 flex justify-center">
          <Brandmark />
        </div>
        <div className="card !p-6 sm:!p-8">
          <h1 className="text-h1 font-bold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1.5 text-small text-fg-secondary">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

/** The auth screens' error message: a persistent live region whose alert box fades in. Render it
 * always; it shows nothing until there is a message. */
export function AuthError({ children }: { children?: ReactNode }) {
  return (
    <div aria-live="polite">
      {children ? (
        <div role="alert" className="mt-5 flex animate-error-in items-start gap-2 rounded-[var(--radius)] border border-danger-bg bg-danger-bg px-4 py-3 text-small text-danger-text [overflow-wrap:anywhere] motion-reduce:animate-none">
          <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0">{children}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Primary submit for the auth screens: hover lift with a neutral token shadow, press scale, and
 * while busy a spinner in the button's own foreground + the busy label + aria-busy (80 % opacity). */
export function AuthSubmit({ busy, busyLabel, disabled, className = '', children }: {
  busy: boolean; busyLabel: string; disabled?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <button type="submit" disabled={disabled ?? busy} aria-busy={busy || undefined}
      className={`btn-primary w-full hover:-translate-y-px hover:shadow-card-hover active:translate-y-0 active:scale-[0.98] disabled:!opacity-80 motion-reduce:transform-none ${className}`}>
      {busy
        ? <><span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />{busyLabel}</>
        : children}
    </button>
  );
}
