/**
 * Shared building blocks for the Control Center's many settings sub-pages. Most Control Center
 * fields have no backend concept in this app (it's a huge network-config surface in the reference
 * with dozens of toggles) — InfoRow/InfoCard render them as honest "—" static display, never fake
 * editable state. Real values (passed in explicitly by each tab) render normally.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, HelpCircle, Pencil, Check, Info } from 'lucide-react';
import { Field } from '../../../components/ui';

/** Wraps a lucide icon in a `title`-bearing span — Lucide icon components don't accept `title`
 * directly (TS: "Property 'title' does not exist on type LucideProps"). */
export function HelpIcon({ text }: { text: string }) {
  return <span title={text}><HelpCircle size={13} className="text-fg-muted" /></span>;
}

export function InfoCard({ title, action, children, defaultOpen = true }: { title: string; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card !p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-left">
          {open ? <ChevronDown size={16} className="text-fg-secondary" /> : <ChevronRight size={16} className="text-fg-secondary" />}
          <h3 className="text-h3 font-medium text-fg">{title}</h3>
        </button>
        {action ?? <button title="Not available yet" className="flex items-center gap-1 text-tiny font-medium text-accent-text"><Pencil size={12} />Edit</button>}
      </div>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

export function InfoRow({ label, value, help }: { label: string; value?: ReactNode; help?: string }) {
  const v = value === undefined || value === null || value === '' ? '—' : value;
  const tone = v === 'YES' ? 'text-success-text' : v === 'NO' ? 'text-danger-text' : 'text-fg-secondary';
  return (
    <div>
      <p className="flex items-center gap-1.5 text-small font-semibold text-fg">{label}{help && <HelpIcon text={help} />}</p>
      <p className={`mt-1 text-small ${tone}`}>{v}</p>
    </div>
  );
}

export function InfoGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">{children}</div>;
}

/** Matches Integrations.tsx / ImpressionReport.tsx's own info-banner pattern — plain icon + text,
 * no box. Used above a card's fields to explain what they're for. */
export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-2 text-small text-fg-secondary">
      <Info size={15} className="mt-0.5 shrink-0 text-accent-text" />
      <p>{children}</p>
    </div>
  );
}

/** Boxed "Heads up!" banner — matches the reference's own callout exactly (bordered box, icon,
 * bold lead-in). Used for a single standout warning, distinct from the plain InfoBanner above. */
export function HeadsUpBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-border bg-accent-subtle p-4 text-small text-fg-secondary">
      <Info size={16} className="mt-0.5 shrink-0 text-accent-text" />
      <p><span className="font-semibold text-fg">Heads up! </span>{children}</p>
    </div>
  );
}

/** "Yes/No" pill — matches the reference's own notification-row toggle exactly (a bordered pill with
 * the current state's label and a colored dot), not a classic switch. Real and self-toggling: click
 * flips it between Yes/No, like every other Control Center control with no backing table. */
export function YesNoToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-tiny font-medium text-fg-secondary hover:bg-page">
      {value ? 'Yes' : 'No'}
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${value ? 'bg-success' : 'bg-border'}`} />
    </button>
  );
}

export function Toggle({ on: initial }: { on: boolean }) {
  const [on, setOn] = useState(initial);
  return <YesNoToggle value={on} onChange={setOn} />;
}

const NOTIFY_SCOPES = ['Notify me for all events', 'Notify me for my managed accounts only'] as const;

/** Real popover — matches the reference's own notification-scope dropdown: two options with a
 * checkmark on whichever is selected, closes on pick or outside click. */
function NotifyScopeSelect() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<(typeof NOTIFY_SCOPES)[number]>(NOTIFY_SCOPES[0]);
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex !w-auto items-center gap-2 !py-1.5">
        {value}<ChevronDown size={14} className="text-fg-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-72 rounded-card border border-border bg-elevated py-1 shadow-elevated">
            {NOTIFY_SCOPES.map((o) => (
              <button key={o} type="button" onClick={() => { setValue(o); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-small text-fg hover:bg-page">
                <span className="w-3.5 shrink-0">{value === o && <Check size={13} />}</span>
                {o}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export interface NotifyDef { name: string; desc: string; inApp?: boolean; email: boolean; dropdown?: boolean }

export function NotificationRow({ n }: { n: NotifyDef }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-fg">{n.name}</p>
        <p className="mt-0.5 text-small text-fg-secondary">{n.desc}</p>
      </div>
      {n.dropdown && <NotifyScopeSelect />}
      {n.inApp !== undefined && (
        <div className="flex shrink-0 flex-col items-start gap-1">
          <span className="text-tiny text-fg-secondary">In-app</span>
          <Toggle on={n.inApp} />
        </div>
      )}
      <div className="flex shrink-0 flex-col items-start gap-1">
        <span className="text-tiny text-fg-secondary">Email</span>
        <Toggle on={n.email} />
      </div>
    </div>
  );
}

/** A notification section — real "Edit" toggles an editing state that shows a Cancel/Save bar
 * (Save stays inert: no backing table for default notification preferences in this app), matching
 * every other Control Center edit flow. The Yes/No pills and scope dropdowns above are already
 * interactive in both states. */
export function NotificationCard({ title, notifs }: { title: string; notifs: NotifyDef[] }) {
  const [editing, setEditing] = useState(false);
  return (
    <InfoCard title={title} action={editing ? <span /> : <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => setEditing(true)}><Pencil size={12} />Edit</button>}>
      <div>{notifs.map((n) => <NotificationRow key={n.name} n={n} />)}</div>
      {editing && (
        <div className="mt-2 flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => setEditing(false)}>Save</button>
        </div>
      )}
    </InfoCard>
  );
}

export interface EditField { label: string; type?: 'boolean' | 'text' }

/** Real editable field grid — booleans render as checkboxes, everything else as a text input.
 * Reusable across any Control Center card built from an InfoGrid of InfoRows. */
function InfoRowsEditForm({ fields, onCancel }: { fields: EditField[]; onCancel: () => void }) {
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-tiny text-fg-secondary"><Info size={13} className="text-fg-muted" /> Fields with an asterisk (*) are mandatory.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => f.type === 'text' ? (
          <Field key={f.label} label={f.label}><input className="input" /></Field>
        ) : (
          <label key={f.label} className="flex items-center gap-2 text-small text-fg">
            <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-border" />
            {f.label}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={onCancel}>Save</button>
      </div>
    </div>
  );
}

/** A settings card built from an InfoGrid of read-only InfoRows — real "Edit" swaps it for a real,
 * interactive field grid (InfoRowsEditForm); Save stays honest (no backing table for any of these
 * network-config fields) but the toggle/edit interaction itself is real. */
export function EditableInfoCard({ title, fields, action, children }: { title: string; fields: EditField[]; action?: ReactNode; children?: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return (
    <InfoCard title={title} action={action ?? (editing ? <span /> : <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => setEditing(true)}><Pencil size={12} />Edit</button>)}>
      {editing ? (
        <InfoRowsEditForm fields={fields} onCancel={() => setEditing(false)} />
      ) : (
        <InfoGrid>{fields.map((f) => <InfoRow key={f.label} label={f.label} />)}</InfoGrid>
      )}
      {children}
    </InfoCard>
  );
}
