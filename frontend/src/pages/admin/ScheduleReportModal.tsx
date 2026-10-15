/**
 * Schedule a saved report (audit F-24). The scheduled-reports worker emails it — a summary plus the
 * rows as a CSV attachment, for a rolling date range — daily, weekly or monthly at a time of day (or
 * on any cron), in the network's time zone (Settings › General). Every role can schedule its own
 * reports (D4); a report is emailed with its OWNER's permissions — an admin's or manager's to any
 * address, a Finance or Read-only member's only to their own email (`scheduleTo: 'self'`: the
 * recipient is shown, not typed), a disabled member's to nobody — which the API checks on save and
 * at every run. "Send now" emails it immediately; "Remove schedule" stops it (the saved report stays).
 */
import { useId, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { Field, Modal } from '../../shared-components/primitives/ui';
import { RANGE_OPTIONS, WEEKDAYS, fromCron, parseRecipients, sendSummary, toCron, type Frequency, type ScheduleForm, type SendResult } from '../../lib/reportSchedule';

export interface SavedReportDto {
  id: string; page: string; name: string; config: unknown; ownerUserId: string;
  /** The team member who saved it (null: no team-member record). */
  owner: { name: string | null; email: string | null; disabled: boolean } | null;
  /** 'self': it can only be emailed to its owner (Finance / Read-only). */
  scheduleTo: 'anyone' | 'self';
  schedule: string | null; rangePreset: string; recipients: string[];
  nextRunAt: string | null; lastRunAt: string | null; lastRunStatus: 'sent' | 'skipped' | 'failed' | null; lastRunDetail: string | null;
}

export function ScheduleReportModal({ report, onClose, onChanged }: { report: SavedReportDto; onClose: () => void; onChanged: () => void }) {
  const formId = useId();
  const { data: settings } = useQuery<{ general?: { timezone?: string } }>('/api/settings');
  const tz = settings?.general?.timezone || 'UTC';
  const [form, setForm] = useState<ScheduleForm>(() => fromCron(report.schedule));
  const [range, setRange] = useState(report.rangePreset || 'yesterday');
  const [recipients, setRecipients] = useState(report.recipients.join('\n'));
  const [sendNote, setSendNote] = useState<string | null>(null);
  const selfOnly = report.scheduleTo === 'self';
  const ownEmail = report.owner?.email ?? null;
  const ownerDisabled = report.owner?.disabled ?? false;
  const canSend = !ownerDisabled && (selfOnly ? Boolean(ownEmail) : report.recipients.length > 0);
  const save = useMutation((body: Record<string, unknown>) => api.patch<SavedReportDto>(`/api/saved-reports/${report.id}`, body));
  const send = useMutation(() => api.post<SendResult>(`/api/saved-reports/${report.id}/send`, {}));
  const set = (patch: Partial<ScheduleForm>) => setForm((f) => ({ ...f, ...patch }));
  const at = (iso: string | null) => (iso ? `${new Date(iso).toLocaleString(undefined, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })} (${tz})` : '—');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const to = selfOnly ? (ownEmail ? [ownEmail] : []) : parseRecipients(recipients);
    if (await save.run({ schedule: toCron(form), rangePreset: range, recipients: to })) { onChanged(); onClose(); }
  };
  const remove = async () => {
    if (await save.run({ schedule: null })) { onChanged(); onClose(); }
  };
  const sendNow = async () => {
    setSendNote(null);
    const r = await send.run(undefined);
    if (r) { setSendNote(sendSummary(r)); onChanged(); }
  };

  return (
    <Modal
      open onClose={onClose} title={`Schedule “${report.name}”`}
      footer={(
        <>
          {report.schedule && <button type="button" className="btn-ghost mr-auto text-danger-text" onClick={remove} disabled={save.busy}>Remove schedule</button>}
          <button type="button" className="btn-ghost" onClick={sendNow} disabled={send.busy || !canSend}
            title={canSend ? `Email it now to ${selfOnly ? ownEmail : 'the saved recipients'}` : ownerDisabled ? "Its owner's account is disabled" : 'Save recipients first'}>{send.busy ? 'Sending…' : 'Send now'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className="btn-primary" disabled={save.busy || ownerDisabled}>{save.busy ? 'Saving…' : 'Save schedule'}</button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        {(save.error || send.error) && <p className="text-small text-danger-text">{save.error ?? send.error}</p>}
        {sendNote && <p className="rounded-[var(--radius)] bg-page px-3 py-2 text-small text-fg">{sendNote}</p>}
        {ownerDisabled && (
          <p className="rounded-[var(--radius)] bg-danger-bg px-3 py-2 text-small text-danger-text">
            {report.owner?.name || ownEmail || 'Its owner'}’s account is disabled, so this report isn’t sent. You can remove its schedule.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Repeat">
            <select className="input" value={form.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="custom">Custom (cron)</option>
            </select>
          </Field>
          {form.frequency !== 'custom' && (
            <Field label="At (time of day)">
              <input className="input" type="time" required value={form.time} onChange={(e) => set({ time: e.target.value })} />
            </Field>
          )}
          {form.frequency === 'weekly' && (
            <Field label="On">
              <select className="input" value={form.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </Field>
          )}
          {form.frequency === 'monthly' && (
            <Field label="On day of the month">
              <select className="input" value={form.dayOfMonth} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          )}
          {form.frequency === 'custom' && (
            <Field label="Cron (minute hour day-of-month month day-of-week)">
              <input className="input font-mono" required value={form.cron} placeholder="0 8 * * 1-5" onChange={(e) => set({ cron: e.target.value })} />
            </Field>
          )}
          <Field label="Date range in each email">
            <select className="input" value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-tiny text-fg-muted">Times are in the network’s time zone, {tz} (Settings › General). The email has a summary and the report rows as a CSV file.</p>
        {selfOnly ? (
          <Field label="Email to">
            <input className="input" disabled value={ownEmail ?? 'No email on record'} />
            <p className="mt-1 text-tiny text-fg-muted">
              Reports saved by Finance and Read-only users are emailed only to that user’s own address{report.owner?.name ? ` — here, ${report.owner.name}` : ''}.
            </p>
          </Field>
        ) : (
          <Field label="Email to (one per line, up to 20)">
            <textarea className="input min-h-[80px]" value={recipients} required placeholder="reports@yourcompany.com" onChange={(e) => setRecipients(e.target.value)} />
          </Field>
        )}
        {report.schedule && (
          <div className="grid grid-cols-1 gap-1 rounded-[var(--radius)] border border-border bg-page px-3 py-2 text-tiny text-fg-secondary sm:grid-cols-2">
            <span>Next email: <span className="text-fg">{at(report.nextRunAt)}</span></span>
            <span>Last run: <span className={report.lastRunStatus === 'sent' ? 'text-fg' : report.lastRunStatus ? 'text-danger-text' : 'text-fg'}>
              {report.lastRunStatus ? `${report.lastRunStatus} — ${at(report.lastRunAt)}` : 'not yet'}</span></span>
            {report.lastRunDetail && <span className="sm:col-span-2">{report.lastRunDetail}</span>}
          </div>
        )}
      </form>
    </Modal>
  );
}
