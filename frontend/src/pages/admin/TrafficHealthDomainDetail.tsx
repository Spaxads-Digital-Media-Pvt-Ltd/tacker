/**
 * Traffic Health › Domain Details — the reference's own real per-domain drill-down, reached via
 * the Overview panel's kebab → "More About This Domain" (verified live at
 * /traffic/domains/view?domain=...). Same tab set as the reference: All Activity, Uptime
 * Incidents, Reputation Flags, Tasks, Usage, Assignments, Mismatches, Configuration.
 *
 * Assignments and Mismatches are genuinely gated/premium features on the reference itself ("Feature
 * Unlock Assignments… Upgrade", "Feature Spot Outdated Tracking Links… Upgrade") — rendered here as
 * the same honest locked state, not a feature we're pretending not to have. Configuration shows the
 * real fields this app tracks (status, mode, verification, SSL status, timestamps) and "—" for the
 * reference's real hosting/certificate infrastructure details (IP, cert serial number, issuer) that
 * this app has no data source for.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Calendar, CheckCircle2, ShieldAlert, Lock } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Badge, Spinner, StateBlock } from '../../components/ui';
import { EmptyShellTable } from '../../components/EmptyShellTable';
import { daysAgo, todayStr, toIso } from '../../components/ReportPageKit';
import type { TrackingDomain } from '../../types';

const TABS = ['All Activity', 'Uptime Incidents', 'Reputation Flags', 'Tasks', 'Usage', 'Assignments', 'Mismatches', 'Configuration'] as const;

function TabBar({ active, onChange }: { active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
      {TABS.map((t) => {
        const on = t === active;
        const badge = t === 'Uptime Incidents' || t === 'Tasks' || t === 'Mismatches' ? 0 : null;
        return (
          <button key={t} onClick={() => onChange(t)}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap rounded-t-[var(--radius)] px-3.5 py-2 text-small font-medium transition-colors ${on ? 'border-b-2 border-accent text-accent-text' : 'text-fg-secondary hover:text-fg'}`}>
            {t}
            {badge !== null && <span className="grid h-4 min-w-[16px] place-items-center rounded-full bg-accent-subtle px-1 text-[10px] font-semibold text-accent-text">{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

function DateRangePicker({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div>
        <label className="label mb-1 flex items-center gap-1.5"><Calendar size={13} /> From</label>
        <input type="date" className="input" value={from} max={to} onChange={(e) => onFrom(e.target.value)} />
      </div>
      <div>
        <label className="label mb-1 block">To</label>
        <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={(e) => onTo(e.target.value)} />
      </div>
    </div>
  );
}

interface ActivityEntry { id: string; action: string; createdAt: string; label: string; actorType: string }
interface DomainSummary {
  offersAssigned: number; partnersUsing: number; clicks: number; conversions: number;
  revenue: number; payout: number; profit: number; margin: number | null; rpc: number | null;
}

function AllActivityTab({ domainId }: { domainId: string }) {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(todayStr());
  const qs = `from=${encodeURIComponent(toIso(from))}&to=${encodeURIComponent(toIso(to, true))}`;
  const { data, loading } = useQuery<ActivityEntry[]>(`/api/traffic-health/domains/${domainId}/activity?${qs}`);
  return (
    <div>
      <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
      {loading ? <StateBlock><Spinner /></StateBlock>
        : !data?.length ? (
          <div className="grid place-items-center rounded-card border border-border bg-surface px-6 py-16 text-center">
            <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-success text-white"><CheckCircle2 size={28} /></div>
            <p className="text-h3 font-semibold text-fg">No domain activity in this period</p>
            <p className="mt-2 text-small text-fg-secondary">Create, update, or delete events for this domain will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full text-small">
              <thead className="bg-page text-tiny text-fg-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Actor</th>
                </tr>
              </thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-2 text-fg-secondary">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 capitalize text-fg">{e.label}</td>
                    <td className="px-3 py-2 text-fg-secondary">{e.actorType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

const INCIDENT_COLUMNS = ['Incident ID', 'Incident Status', 'Incident Type', 'Diagnosis Details', 'Is Action Required?', 'Detected', 'Last Observation', 'Resolution', 'Time to resolution'];
function UptimeIncidentsTab() {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(todayStr());
  return (
    <div>
      <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <EmptyShellTable columns={INCIDENT_COLUMNS} status="Ongoing" />
    </div>
  );
}

function ReputationFlagsTab() {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(todayStr());
  return (
    <div>
      <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <div className="grid place-items-center rounded-card border border-border bg-surface px-6 py-16 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-accent text-white"><ShieldAlert size={28} /></div>
        <p className="text-h3 font-semibold text-fg">Gain access to reputation monitoring</p>
        <p className="mt-2 max-w-md text-small text-fg-secondary">
          Monitor this domain across leading blacklist sources.{' '}
          <button title="Not available yet" className="font-medium text-accent-text">Learn more</button>
        </p>
      </div>
    </div>
  );
}

const TASK_COLUMNS = ['Task ID', 'Task Status', 'Related Incident', 'Instructions', 'Detected', 'Completed'];
function TasksTab() {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(todayStr());
  return (
    <div>
      <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <EmptyShellTable columns={TASK_COLUMNS} status="All" />
    </div>
  );
}

const USAGE_COLUMNS = [
  'Partners Using Domain', 'Offers Ran', 'Imp', 'RPM', 'CPM', 'Gross Clicks', 'Clicks', 'Uniq. Clicks',
  'Dup. Clicks', 'Invalid clicks', 'Total CV', 'CV', 'VT CV', 'CTR', 'Throttle', 'CVR', 'CPC', 'CPA',
  'RPC', 'RPA', 'Revenue', 'Payout', 'Profit', 'Margin',
];
function UsageTab({ domainId }: { domainId: string }) {
  const [view, setView] = useState<'summary' | 'partner' | 'offer'>('summary');
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(todayStr());
  const qs = `from=${encodeURIComponent(toIso(from))}&to=${encodeURIComponent(toIso(to, true))}`;
  const { data: summary, loading } = useQuery<DomainSummary>(`/api/traffic-health/domains/${domainId}/summary?${qs}`);
  const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
  const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex overflow-hidden rounded-[var(--radius)] border border-border">
          {(['summary', 'partner', 'offer'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-4 py-2 text-small font-medium capitalize ${view === v ? 'bg-accent-subtle text-accent-text' : 'text-fg-secondary hover:bg-page'}`}>
              {v === 'summary' ? 'Summary' : v === 'partner' ? 'By Partner' : 'By Offer'}
            </button>
          ))}
        </div>
        <DateRangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : view !== 'summary' ? (
          <>
            <p className="mb-3 text-tiny text-fg-muted">Per-partner and per-offer breakdown requires hostname-level click tagging — not yet in schema. Summary stats below are live via offer assignment.</p>
            <EmptyShellTable columns={USAGE_COLUMNS} search={false} />
          </>
        ) : (
          <div className="grid grid-cols-2 gap-4 rounded-card border border-border p-4 sm:grid-cols-4">
            {[
              ['Partners', fmt(summary?.partnersUsing)],
              ['Offers assigned', fmt(summary?.offersAssigned)],
              ['Clicks', fmt(summary?.clicks)],
              ['Conversions', fmt(summary?.conversions)],
              ['Revenue', money(summary?.revenue)],
              ['Payout', money(summary?.payout)],
              ['Profit', money(summary?.profit)],
              ['RPC', summary?.rpc != null ? money(summary.rpc) : '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-tiny text-fg-muted">{label}</p>
                <p className="text-h3 font-semibold text-fg">{value}</p>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

function GatedPanel({ title, description, rows }: { title: string; description: string; rows: { label: string; hint: string }[] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border">
        <div className="border-b border-border px-4 py-3"><h3 className="text-h3 font-medium text-fg">Domain Settings for Tracking</h3></div>
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-small font-medium text-fg">{r.label}</p>
                <p className="text-tiny text-fg-secondary">{r.hint}</p>
              </div>
              <span className="text-small text-fg-muted">N/A</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid place-items-center rounded-card border border-border bg-surface px-6 py-16 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-accent text-white"><Lock size={26} /></div>
        <p className="text-h3 font-semibold text-fg">{title}</p>
        <p className="mt-2 max-w-md text-small text-fg-secondary">
          {description}{' '}
          <button title="Not available yet" className="font-medium text-accent-text">Learn more</button>
        </p>
        <button title="Not available yet" className="btn-primary mt-4">Upgrade</button>
      </div>
    </div>
  );
}

function AssignmentsTab() {
  return (
    <GatedPanel
      title="Feature Unlock Assignments"
      description="Quickly respond to domain issues by reassigning traffic to healthy domains to save revenue."
      rows={[
        { label: 'Offers Assigned', hint: 'Tracking links use this domain by default for any Partners running these Offers' },
        { label: 'Partners Assigned', hint: 'Tracking links use this domain for specific Partners across any Offer they run' },
        { label: 'Combinations Assigned', hint: 'Tracking links use this domain for specific Partner and Offer combinations' },
      ]}
    />
  );
}

function MismatchesTab() {
  return (
    <GatedPanel
      title="Feature Spot Outdated Tracking Links"
      description="Catch Partners using old URLs after a domain rotation before it causes reputation issues."
      rows={[
        { label: 'Partner Mismatches', hint: 'Partners with usage tracked through this domain while assigned to another' },
        { label: 'Offer Mismatches', hint: 'Offers with usage tracked through this domain while assigned to another' },
      ]}
    />
  );
}

function ConfigurationTab({ domain }: { domain: TrackingDomain }) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-4 py-2 text-small">
      <span className="text-fg-secondary">{label}</span>
      <span className="text-fg">{value}</span>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-h3 font-medium text-fg">General</h3>
          <button title="Not available yet" className="text-tiny font-medium text-accent-text">Edit</button>
        </div>
        {row('Name', <span className="font-mono">{domain.host}</span>)}
      </div>
      <div className="rounded-card border border-border p-4">
        <h3 className="mb-2 text-h3 font-medium text-fg">Tracking Domain Details</h3>
        {row('ID', domain.ref)}
        {row('Status', <Badge value={domain.status} />)}
        {row('Assignable', <Badge value={domain.status === 'active' ? 'Yes' : 'No'} />)}
      </div>
      <div className="rounded-card border border-border p-4">
        <h3 className="mb-2 text-h3 font-medium text-fg">Coverage</h3>
        {row('Mode', domain.mode === 'subdomain' ? 'Subdomain on our domain' : 'Custom domain (CNAME)')}
        {row('Verification', <Badge value={domain.verificationState} />)}
        {row('Management Type', '—')}
        {row('Internal Note', '—')}
        {row('Created', new Date(domain.createdAt).toLocaleString())}
        {row('Modified', new Date(domain.updatedAt).toLocaleString())}
      </div>
      <div className="rounded-card border border-border p-4">
        <h3 className="mb-2 text-h3 font-medium text-fg">Hosting</h3>
        {row('IP Address', '—')}
        {row('Hosting Type', '—')}
      </div>
      <div className="rounded-card border border-border p-4">
        <h3 className="mb-2 text-h3 font-medium text-fg">SSL Certificate</h3>
        {row('Status', <Badge value={domain.sslStatus} />)}
        {row('Common Name', '—')}
        {row('Serial Number', '—')}
        {row('Managed By', '—')}
        {row('Issued By', '—')}
        {row('Expiration', '—')}
      </div>
    </div>
  );
}

export default function TrafficHealthDomainDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<string>('All Activity');
  const { data: domain, loading, error } = useQuery<TrackingDomain>(id ? `/api/tracking-domains/${id}` : null);

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error || !domain) return <StateBlock>{error ?? 'Domain not found.'}</StateBlock>;

  return (
    <>
      <button onClick={() => nav('/app/traffic-health')} className="btn-ghost !py-1.5 !px-3 text-tiny mb-3">← Back</button>
      <PageHeader title={`Domain Details: ${domain.host}`} subtitle={`Traffic Health › Domain Details: ${domain.host}`} />
      <TabBar active={tab} onChange={setTab} />
      {tab === 'All Activity' && <AllActivityTab domainId={domain.id} />}
      {tab === 'Uptime Incidents' && <UptimeIncidentsTab />}
      {tab === 'Reputation Flags' && <ReputationFlagsTab />}
      {tab === 'Tasks' && <TasksTab />}
      {tab === 'Usage' && <UsageTab domainId={domain.id} />}
      {tab === 'Assignments' && <AssignmentsTab />}
      {tab === 'Mismatches' && <MismatchesTab />}
      {tab === 'Configuration' && <ConfigurationTab domain={domain} />}
    </>
  );
}
