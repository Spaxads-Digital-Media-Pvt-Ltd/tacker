import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Overlay } from './ui';
import { ConfirmContext, type ConfirmFn, type ConfirmOptions } from './confirm';

/**
 * In-app confirmation dialog (replaces native window.confirm / window.alert). Escape / backdrop
 * click / Cancel close it without acting (disabled while the action runs). Focus lands on Cancel
 * for destructive actions (Enter won't delete by accident), otherwise on the confirm button; Tab is
 * kept inside the dialog and focus returns to the trigger afterwards.
 */
export function ConfirmDialog({ options, onClose }: { options: ConfirmOptions | null; onClose: (confirmed: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!options) return;
    setBusy(false);
    setError(null);
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ((options.destructive && options.cancelLabel !== null ? cancelRef : confirmRef).current?.focus()), 0);
    return () => { clearTimeout(t); prev?.focus?.(); };
  }, [options]);

  if (!options) return null;
  const ackOnly = options.cancelLabel === null;
  const confirmLabel = options.confirmLabel ?? (ackOnly ? 'OK' : 'Confirm');
  const close = (confirmed: boolean) => { if (!busy) onClose(confirmed); };

  const confirm = async () => {
    if (busy) return;
    if (!options.onConfirm) { onClose(true); return; }
    setBusy(true);
    setError(null);
    try {
      await options.onConfirm();
      setBusy(false);
      onClose(true);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    }
  };

  // Keep Tab focus inside the dialog.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !boxRef.current) return;
    const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (items.length === 0) return;
    const first = items[0]!, last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <Overlay onClose={() => close(false)}>
      <div
        ref={boxRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="animate-fade-in w-full max-w-md rounded-card border border-border bg-elevated p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id="confirm-title" className="text-h3 font-semibold tracking-tight text-fg">{options.title}</h2>
        <div id="confirm-message" className="mt-2 text-small text-fg-secondary">{options.message}</div>
        {error && <p role="alert" className="mt-3 rounded-[var(--radius)] bg-danger-bg px-3 py-2 text-small text-danger-text">{error}</p>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {!ackOnly && (
            <button ref={cancelRef} type="button" className="btn-ghost" disabled={busy} onClick={() => close(false)}>
              {options.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button ref={confirmRef} type="button" className={options.destructive ? 'btn-danger' : 'btn-primary'} disabled={busy} aria-busy={busy} onClick={confirm}>
            {busy ? <><span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />{confirmLabel}…</> : confirmLabel}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/** Mounted once at the app root (main.tsx); renders the single shared ConfirmDialog. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback<ConfirmFn>((options) => new Promise<boolean>((resolve) => {
    // A second request while one is open cancels the first (never two stacked dialogs).
    setState((prev) => { prev?.resolve(false); return { options, resolve }; });
  }), []);
  const onClose = useCallback((confirmed: boolean) => {
    setState((s) => { s?.resolve(confirmed); return null; });
  }, []);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog options={state?.options ?? null} onClose={onClose} />
    </ConfirmContext.Provider>
  );
}
