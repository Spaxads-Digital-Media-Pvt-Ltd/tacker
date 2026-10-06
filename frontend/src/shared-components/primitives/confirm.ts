/**
 * In-app confirmation (replaces native window.confirm / window.alert). The dialog itself and its
 * provider live in ConfirmDialog.tsx; <ConfirmProvider> is mounted once in main.tsx.
 *
 *   const confirm = useConfirm();
 *   confirm({ title: 'Delete postback?', message: '…', confirmLabel: 'Delete', destructive: true,
 *             onConfirm: async () => { …the existing action… } });
 *
 * Resolves true after the action completes, false if the user cancelled.
 */
import { createContext, useContext, type ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  /** Defaults to "Confirm" (or "OK" when `cancelLabel` is null). */
  confirmLabel?: string;
  /** Pass null for an acknowledge-only notice (single OK button). Defaults to "Cancel". */
  cancelLabel?: string | null;
  /** Red confirm button — Delete / Revoke / Remove / Reject. */
  destructive?: boolean;
  /**
   * The action to run on confirm. The dialog stays open with its buttons disabled until it
   * settles (no double submission), then closes. If it throws, the message is shown in the dialog
   * and nothing else changes; the caller's own error handling (mutation error state) still applies.
   */
  onConfirm?: () => unknown | Promise<unknown>;
}

export type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm() must be used inside <ConfirmProvider>.');
  return confirm;
}
