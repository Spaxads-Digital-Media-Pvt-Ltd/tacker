/**
 * Void an unpaid invoice (O8). Invoices are financial records: a void invoice stays in the list with
 * its number, amounts and history, plus who voided it, when and why — and its period is free for a
 * corrected invoice. Paid invoices can't be voided.
 */
import { useState } from 'react';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { Field, Modal } from '../../shared-components/primitives/ui';

export function VoidInvoiceModal({ invoiceRef, endpoint, onClose, onVoided }: {
  invoiceRef: number; endpoint: string; onClose: () => void; onVoided: () => void;
}) {
  const [reason, setReason] = useState('');
  const run = useMutation((body: { reason: string }) => api.post(endpoint, body));
  const submit = async () => { if (await run.run({ reason: reason.trim() })) { onVoided(); onClose(); } };
  return (
    <Modal open onClose={onClose} title={`Void invoice #${invoiceRef}?`}
      footer={(
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-danger" disabled={run.busy || reason.trim().length < 3} onClick={() => void submit()}>
            {run.busy ? 'Voiding…' : 'Void invoice'}
          </button>
        </>
      )}
    >
      <div className="space-y-3 text-small">
        {run.error && <p className="text-danger-text">{run.error}</p>}
        <p className="text-fg-secondary">
          The invoice stays on record (number, amounts and history) marked Void, and its period becomes free for a corrected
          invoice. This can't be undone.
        </p>
        <Field label="Reason *">
          <textarea className="input min-h-[70px]" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong period — reissued as a new invoice" />
        </Field>
      </div>
    </Modal>
  );
}
