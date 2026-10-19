/** Small pieces the Sales pages share: the stage chip, a staff picker, the "why was it lost?" prompt. */
import { useState, type FormEvent } from 'react';
import { Modal, Field } from '../../../shared-components/primitives/ui';
import { Chip } from '../kit';
import { stageOf, type StaffMember } from '../../../lib/platformSales';

export function StageChip({ stage }: { stage: string }) {
  const s = stageOf(stage);
  return <Chip className={s.chip}><span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${s.dot}`} />{s.label}</Chip>;
}

/** Pick a team member (owner, assignee, account manager); '' = nobody. */
export function StaffSelect({ staff, value, onChange, noneLabel = 'Unassigned', className = 'input', ariaLabel, disabled }: {
  staff: StaffMember[] | null; value: string; onChange: (id: string) => void; noneLabel?: string | null; className?: string; ariaLabel?: string; disabled?: boolean;
}) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} disabled={disabled}>
      {noneLabel !== null && <option value="">{noneLabel}</option>}
      {(staff ?? []).map((m) => <option key={m.id} value={m.id}>{m.name || m.email} · {m.role_name}</option>)}
    </select>
  );
}

/** Asks why a deal was lost (required), then calls onSubmit. */
export function LostReasonModal({ company, onClose, onSubmit }: { company: string; onClose: () => void; onSubmit: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const err = await onSubmit(reason.trim());
    setBusy(false);
    if (err) setError(err);
  };
  const common = ['Price', 'Went with a competitor', 'No budget', 'No response', 'Not a fit (too small)', 'Timing — later'];
  return (
    <Modal open onClose={onClose} title={`Mark ${company} as lost`}>
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Why was it lost?">
          <input className="input" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Went with a competitor" autoFocus />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {common.map((c) => <button key={c} type="button" className="rounded-full border border-border px-2.5 py-1 text-tiny text-fg-secondary hover:border-accent hover:text-fg" onClick={() => setReason(c)}>{c}</button>)}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || !reason.trim()}>{busy ? 'Saving…' : 'Mark as lost'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** A deal moved to Won: create the customer's network now, or just mark it won (convert later). */
export function WonChoice({ company, onClose, onJustWon, onConvert }: { company: string; onClose: () => void; onJustWon: () => void; onConvert: () => void }) {
  return (
    <Modal open onClose={onClose} title={`${company} — won`}>
      <p className="text-small text-fg-secondary">Create their network now (owner login, plan and trial), or just mark the deal won and convert it later from the lead’s page.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onJustWon}>Just mark as won</button>
        <button type="button" className="btn-primary" onClick={onConvert}>Convert to customer</button>
      </div>
    </Modal>
  );
}
