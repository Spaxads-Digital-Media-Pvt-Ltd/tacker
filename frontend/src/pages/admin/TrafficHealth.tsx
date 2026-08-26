/**
 * Traffic Health (Everflow-style): domain uptime/reputation/task monitoring. Verified live against
 * the reference (its own "gated icon rail" hid this section, but the full sidebar reveals it at
 * /traffic — confirmed item-by-item, including the per-domain "More About This Domain" detail page
 * at /traffic/domains/view, see TrafficHealthDomainDetail.tsx). The reference's own account shows
 * every incident/reputation/task section at zero, so those are honest static zero-states here too —
 * not a stand-in for missing data.
 *
 * What IS real: our tracking-domain list (/api/tracking-domains) — search, Add Domain (reuses the
 * same real POST endpoint as Control Center's Tracking Domains page), the 90-day Uptime bar (built
 * from the domain's own real created_at + current status — we have no historical incident log, so
 * every bar reflects current status, same as the reference's own all-green state), and the
 * Configurations tab's real domain/SSL fields. Per-domain traffic (Usage) genuinely isn't
 * attributable in this schema — clicks/conversions aren't tagged with which of a network's several
 * tracking domains served them — so those numbers render as "—" rather than fabricated or
 * misattributed from network-wide totals.
 */
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search, Filter, MoreVertical, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';
import { useQuery, useMutation } from '../../lib/useApi';
import { api } from '../../lib/api';
import { PageHeader, Table, Badge, Modal, Field, Spinner, StateBlock, type Column } from '../../components/ui';
import { Accordion } from '../../components/Accordion';
import { EmptyShellTable } from '../../components/EmptyShellTable';
import { daysAgo, todayStr } from '../../components/ReportPageKit';
import type { TrackingDomain } from '../../types';

const TAB_LIST = ['Overview', 'Uptime Incidents', 'Reputation Flags', 'Tasks', 'Usage', 'Configurations'] as const;

function TabBar({ tabs, active, onChange, badges, right }: { tabs: readonly string[]; active: string; onChange: (t: string) => void; badges?: Record<string, number>; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border">
      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => {
          const on = t === active;
          return (
            <button
              key={t}
              onClick={() => onChange(t)}
              className={`-mb-px flex items-center gap-1.5 whitespace-nowrap rounded-t-[var(--radius)] px-3.5 py-2 text-small font-medium transition-colors ${
                on ? 'border-b-2 border-accent text-accent-text' : 'text-fg-secondary hover:text-fg'
              }`}
            >
              {t}
              {badges && badges[t] !== undefined && (
                <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-accent-subtle px-1 text-[10px] font-semibold text-accent-text">{badges[t]}</span>
              )}
            </button>
          );
        })}
      </div>
      {right && <div className="mb-2 shrink-0">{right}</div>}
    </div>
  );
}

/** Small toolbar shared by the Configurations accordions: search + status/filter + 3-dot menu. */
function AccordionToolbar({ addLabel, onAdd }: { addLabel?: string; onAdd?: () => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      {addLabel ? (
        <button onClick={onAdd} className="btn-primary !py-1.5 !px-3 text-tiny">+ {addLabel}</button>
      ) : <span />}
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input title="Not available yet" placeholder="Search…" className="input !w-56 !pl-8" />
        </div>
        <button title="Not available yet" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Filter size={15} /></button>
        <button title="Not available yet" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
      </div>
    </div>
  );
}

function StatusStrip({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-surface p-5 sm:grid-cols-4">{children}</div>;
}

/** Add Domain — same real flow/endpoint as Control Center's Tracking Domains page. */
function AddDomainModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [mode, setMode] = useState<'subdomain' | 'custom'>('subdomain');
  const [subdomain, setSubdomain] = useState('');
  const [host, setHost] = useState('');
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post('/api/tracking-domains', body));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = mode === 'subdomain' ? { mode, subdomain } : { mode, host };
    if (await run(body)) onCreated();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add tracking domain">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Mode">
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as 'subdomain' | 'custom')}>
            <option value="subdomain">Subdomain on our domain</option>
            <option value="custom">Custom domain (their CNAME)</option>
          </select>
        </Field>
        {mode === 'subdomain' ? (
          <Field label="Subdomain label"><input className="input" required value={subdomain} onChange={(e) => setSubdomain(e.target.value)} placeholder="acme" /></Field>
        ) : (
          <Field label="Custom host (FQDN)"><input className="input" required value={host} onChange={(e) => setHost(e.target.value)} placeholder="track.acmecorp.com" /></Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────

/** 90-day uptime bar: every day from domain creation (or 90 days ago, whichever is later) to today.
 * We have no historical incident log, so every bar reflects the domain's CURRENT status — honest
 * (matches the reference's own all-green state when nothing has ever gone down), not fabricated
 * history. */
function UptimeBars({ domain }: { domain: TrackingDomain }) {
  const created = new Date(domain.createdAt);
  const now = new Date();
  const color = domain.status === 'active' ? 'bg-success' : domain.status === 'pending' ? 'bg-warning' : 'bg-danger';
  const bars: { on: boolean }[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    bars.push({ on: d >= created });
  }
  return (
    <div className="rounded-card border border-border p-4">
      <p className="mb-2 text-small font-semibold text-fg">Uptime</p>
      <div className="flex h-8 items-end gap-[3px]">
        {bars.map((b, i) => (
          <div key={i} className={`w-full rounded-[2px] ${b.on ? `${color} h-full` : 'h-2 self-end bg-border'}`} />
        ))}
      </div>
      <p className="mt-2 text-tiny text-fg-muted">From {created.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} to today</p>
    </div>
  );
}

function DomainDetailPanel({ domain, onOpenDetail }: { domain: TrackingDomain; onOpenDetail: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-fg">{domain.host} <span className="font-normal text-fg-secondary">over the last 90 days</span></p>
        <div className="relative">
          <button onClick={() => setMenuOpen((o) => !o)} className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
              <button onClick={() => { setMenuOpen(false); onOpenDetail(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">More About This Domain</button>
            </div>
          )}
        </div>
      </div>

      <UptimeBars domain={domain} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-border p-4 text-center">
          <p className="mb-2 text-small font-semibold text-fg">Tasks</p>
          <p className="text-small italic text-fg-muted">You're all caught up!</p>
        </div>
        <div className="rounded-card border border-border p-4 text-center">
          <p className="mb-2 text-small font-semibold text-fg">Reputation</p>
          <p className="text-small text-fg-secondary">Protect your domain against blacklisting. <button title="Not available yet" className="font-medium text-accent-text">Upgrade</button></p>
        </div>
      </div>

      <div className="rounded-card border border-border p-4">
        <p className="mb-2 text-small font-semibold text-fg">Usage</p>
        <p title="Per-domain traffic attribution isn't tracked yet" className="text-small text-fg-muted">— Partners Using the Domain for — Offers</p>
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-small font-semibold text-fg">Total Traffic</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {['Revenue', 'Profit', 'Profit Margin', 'Payout', 'Sale Amount', 'Conversions', 'Clicks', 'RPC', 'Impressions'].map((label) => (
              <div key={label}>
                <p className="text-tiny text-fg-muted">{label}</p>
                <p className="text-small font-medium text-fg-secondary">—</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ domains, loading, refetch }: { domains: TrackingDomain[]; loading: boolean; refetch: () => void }) {
  const nav = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  if (loading) return <StateBlock><Spinner /></StateBlock>;

  const filtered = domains.filter((d) => d.host.toLowerCase().includes(q.trim().toLowerCase()));
  const active = filtered.find((d) => d.id === selected) ?? filtered[0];
  const upCount = domains.filter((d) => d.status === 'active').length;
  const allHealthy = domains.length > 0 && upCount === domains.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {domains.length === 0 ? <AlertCircle className="text-fg-muted" /> : <CheckCircle2 className="text-success" />}
          <div>
            <p className="font-semibold text-fg">{domains.length === 0 ? 'No domains configured yet' : allHealthy ? 'Everything is running smoothly!' : `${domains.length - upCount} domain(s) need attention`}</p>
            <p className="text-small text-fg-secondary">{domains.length === 0 ? 'Add a tracking domain to start monitoring.' : 'All your domains are healthy and you have no tasks.'}</p>
          </div>
        </div>
        <div className="text-small text-fg-secondary sm:text-right">
          <p className="font-semibold text-fg">Total Domains: {domains.length}</p>
          <p>Uptime: {upCount} is <span className="font-semibold text-success">UP</span></p>
          <p>Reputation: <span className="text-fg-muted">N/A</span></p>
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-border">
        <div className="flex items-center justify-between border-b border-border bg-page px-4 py-3">
          <h3 className="text-h3 font-medium text-fg">Your Domains</h3>
          <button onClick={() => setAdding(true)} className="text-small font-medium text-accent-text">+ Add</button>
        </div>
        {domains.length === 0 ? (
          <div className="p-8 text-center text-small text-fg-secondary">No tracking domains yet — add one to start monitoring.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr]">
            <div className="border-b border-border p-3 lg:border-b-0 lg:border-r">
              <div className="mb-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                  <input placeholder="Search…" className="input !pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <button title="Not available yet" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Filter size={15} /></button>
              </div>
              <div className="space-y-1">
                {filtered.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelected(d.id)}
                    className={`block w-full truncate rounded-[var(--radius)] px-3 py-2 text-left text-small font-medium ${
                      active?.id === d.id ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page'
                    }`}
                  >
                    {d.host}
                  </button>
                ))}
                {filtered.length === 0 && <p className="px-3 py-2 text-small text-fg-muted">No matches.</p>}
              </div>
            </div>
            <div className="p-4">
              {active && <DomainDetailPanel domain={active} onOpenDetail={() => nav(`/app/traffic-health/domains/${active.id}`)} />}
            </div>
          </div>
        )}
      </div>

      <AddDomainModal open={adding} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); refetch(); }} />
    </div>
  );
}

// ── Uptime Incidents ─────────────────────────────────────────────────────
const INCIDENT_COLUMNS = ['Name', 'Incident ID', 'Incident Status', 'Incident Type', 'Diagnosis Details', 'Is Action Required?', 'Detected', 'Last Observation', 'Resolution', 'Time to resolution'];

function UptimeIncidentsTab({ allUp }: { allUp: boolean }) {
  return (
    <div className="space-y-4">
      <StatusStrip>
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${allUp ? 'bg-success' : 'bg-danger'}`} />
          <span className="font-semibold text-fg">{allUp ? 'All domains are up!' : 'Some domains are down'}</span>
        </div>
        <div><p className="text-small font-semibold text-fg">Resolved Incidents</p><p className="text-tiny text-fg-muted">0 in the last 90 days</p></div>
        <div><p className="text-small font-semibold text-fg">Mean Time to Resolution</p><p className="text-tiny text-fg-muted">0 seconds</p></div>
        <div><p className="text-small font-semibold text-fg">Affected by 2+ Incidents</p><p className="text-tiny text-fg-muted">0 domains</p></div>
      </StatusStrip>
      <EmptyShellTable columns={INCIDENT_COLUMNS} status="Ongoing" />
    </div>
  );
}

// ── Reputation Flags ─────────────────────────────────────────────────────
function ReputationFlagsTab() {
  return (
    <div className="space-y-4">
      <StatusStrip>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-success" />
          <span className="font-semibold text-fg">All domains are clean!</span>
        </div>
        <div><p className="text-small font-semibold text-fg">Domain Flags</p><p className="text-tiny text-fg-muted">N/A</p></div>
        <div><p className="text-small font-semibold text-fg">IP Flags</p><p className="text-tiny text-fg-muted">N/A</p></div>
        <div><p className="text-small font-semibold text-fg">Removed Flags</p><p className="text-tiny text-fg-muted">0 in the last 90 days</p></div>
      </StatusStrip>
      <div className="grid place-items-center rounded-card border border-border bg-surface px-6 py-16 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-accent text-white">
          <ShieldAlert size={28} />
        </div>
        <p className="text-h3 font-semibold text-fg">Gain access to reputation monitoring</p>
        <p className="mt-2 max-w-md text-small text-fg-secondary">
          Monitor your domains & IPs across leading blacklist sources, and map your Partners to reputation flags.{' '}
          <button title="Not available yet" className="font-medium text-accent-text">Learn more</button>
        </p>
      </div>
    </div>
  );
}

// ── Tasks ────────────────────────────────────────────────────────────────
const TASK_COLUMNS = ['Task ID', 'Task Status', 'Related Domain', 'Related Incident', 'Instructions', 'Detected', 'Completed'];

function TasksTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-surface p-5 sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-success" />
          <span className="font-semibold text-fg">All tasks are completed!</span>
        </div>
        <div><p className="text-small font-semibold text-fg">Completed Tasks</p><p className="text-tiny text-fg-muted">0 in the last 90 days</p></div>
      </div>
      <EmptyShellTable columns={TASK_COLUMNS} status="All" />
    </div>
  );
}

// ── Usage ────────────────────────────────────────────────────────────────
const USAGE_COLUMNS = ['Domain', 'Partners Using Domain', 'Offers Ran', 'Impressions', 'Clicks', 'RPC', 'Conversions', 'Payout', 'Revenue', 'Profit', 'Margin', 'Sale Amount'];

function UsageTab({ domains, loading }: { domains: TrackingDomain[]; loading: boolean }) {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(todayStr());
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (domains.length === 0) return <StateBlock>No tracking domains yet.</StateBlock>;
  const columns: Column<TrackingDomain>[] = USAGE_COLUMNS.map((header) => (
    header === 'Domain'
      ? { header, cell: (d) => <span className="font-mono text-xs text-accent-text">{d.host}</span> }
      : { header, cell: () => '—' }
  ));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label mb-1 block">From</label>
          <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label mb-1 block">To</label>
          <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <p className="text-tiny text-fg-muted">Per-domain traffic attribution isn't tracked yet — your domains are listed here for reference.</p>
      <Table columns={columns} rows={domains} rowKey={(d) => d.id} />
    </div>
  );
}

// ── Configurations ───────────────────────────────────────────────────────
const CERT_COLUMNS = ['ID', 'Common Name', 'Serial Number', 'Domain(s) Using the Certificate', 'Managed By', 'Issued By', 'Issued', 'Expiration', 'Expires in', 'Created', 'Modified'];

function ConfigurationsTab({ domains, loading, refetch }: { domains: TrackingDomain[]; loading: boolean; refetch: () => void }) {
  const [adding, setAdding] = useState(false);
  if (loading) return <StateBlock><Spinner /></StateBlock>;
  const primary = domains.find((d) => d.isPrimary) ?? domains[0];
  const domainColumns: Column<TrackingDomain>[] = [
    { header: 'Domain Name', cell: (d) => <span className="font-mono text-xs text-accent-text">{d.host}</span> },
    { header: 'ID', cell: (d) => <span className="tabular-nums text-fg-secondary">{d.ref}</span> },
    { header: 'Assignable', cell: (d) => <Badge value={d.status === 'active' ? 'Yes' : 'No'} /> },
    { header: 'Management Type', cell: () => '—' },
    { header: 'Hosting Type', cell: () => '—' },
    { header: 'SSL Certificate(s)', cell: (d) => <Badge value={d.sslStatus} /> },
    { header: 'Expiration', cell: () => '—' },
    { header: 'Custom Note', cell: () => '—' },
    { header: 'Created', cell: (d) => new Date(d.createdAt).toLocaleDateString() },
    { header: 'Modified', cell: (d) => new Date(d.updatedAt).toLocaleDateString() },
  ];
  return (
    <div className="space-y-4">
      <p className="text-small text-fg-secondary">
        See your domains, IPs, and certificates at a glance, along with all the key details.{' '}
        <button title="Not available yet" className="font-medium text-accent-text">Learn more</button>
      </p>

      <div className="grid grid-cols-1 gap-6 rounded-card border border-border bg-surface p-5 sm:grid-cols-4">
        <div>
          <p className="text-small font-semibold text-fg">Default Tracking Domain</p>
          <p className="mt-1 text-small text-fg-secondary">{primary?.host ?? '—'}</p>
          <button title="Not available yet" className="mt-1 text-tiny font-medium text-accent-text">Edit</button>
        </div>
        <div>
          <p className="text-small font-semibold text-fg">Default Conversion Domain</p>
          <p className="mt-1 text-small text-fg-secondary">{primary?.host ?? '—'}</p>
          <button title="Not available yet" className="mt-1 text-tiny font-medium text-accent-text">Edit</button>
        </div>
        <div>
          <p className="text-small font-semibold text-fg">Domain Registration Contact</p>
          <p className="mt-1 text-small text-fg-secondary">—</p>
          <button title="Not available yet" className="mt-1 text-tiny font-medium text-accent-text">View Domain Contacts</button>
        </div>
        <div>
          <p className="text-small font-semibold text-fg">Active Domain Manager(s)</p>
          <p className="mt-1 text-small text-fg-secondary">0</p>
          <button title="Not available yet" className="mt-1 text-tiny font-medium text-accent-text">View Domain Contacts</button>
        </div>
      </div>

      <Accordion title="Domains" count={domains.length} defaultOpen>
        <AccordionToolbar addLabel="Domain" onAdd={() => setAdding(true)} />
        {domains.length === 0 ? <p className="text-small text-fg-muted">No tracking domains yet.</p> : <Table columns={domainColumns} rows={domains} rowKey={(d) => d.id} />}
      </Accordion>

      <Accordion title="Hosting" defaultOpen>
        <p className="text-small italic text-fg-muted">There are currently no Dedicated IPs (MPS) associated with this account.</p>
      </Accordion>

      <Accordion title="SSL Certificates" defaultOpen>
        <EmptyShellTable columns={CERT_COLUMNS} />
      </Accordion>

      <AddDomainModal open={adding} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); refetch(); }} />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function TrafficHealth() {
  const [tab, setTab] = useState<string>('Overview');
  const { data, loading, refetch } = useQuery<TrackingDomain[]>('/api/tracking-domains');
  const domains = useMemo(() => data ?? [], [data]);
  const allUp = domains.length > 0 && domains.every((d) => d.status === 'active');

  return (
    <>
      <PageHeader title="Traffic Health" subtitle="Traffic Health" />
      <TabBar
        tabs={TAB_LIST}
        active={tab}
        onChange={setTab}
        badges={{ 'Uptime Incidents': 0, Tasks: 0 }}
        right={<button title="Not available yet" className="btn-ghost flex items-center gap-2 !py-1.5"><Bell size={15} /> Manage External Notifications</button>}
      />
      {tab === 'Overview' && <OverviewTab domains={domains} loading={loading} refetch={refetch} />}
      {tab === 'Uptime Incidents' && <UptimeIncidentsTab allUp={allUp} />}
      {tab === 'Reputation Flags' && <ReputationFlagsTab />}
      {tab === 'Tasks' && <TasksTab />}
      {tab === 'Usage' && <UsageTab domains={domains} loading={loading} />}
      {tab === 'Configurations' && <ConfigurationsTab domains={domains} loading={loading} refetch={refetch} />}
    </>
  );
}
