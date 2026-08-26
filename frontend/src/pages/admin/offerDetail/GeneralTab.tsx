import { useState, type ReactNode } from 'react';
import { api } from '../../../lib/api';
import { useQuery, useMutation } from '../../../lib/useApi';
import { Badge, Spinner } from '../../../components/ui';
import { CopyBox } from '../../../components/CopyBox';
import type { Offer, TrackingDomain } from '../../../types';

type Row = { id: string; [k: string]: unknown };
interface AggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[] }

const money = (v: string | number | undefined) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0))}`;
const num = (v: string | number | undefined) => new Intl.NumberFormat('en-US').format(Number(v ?? 0));

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="card !p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-h3 font-medium text-fg">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-border py-2 text-small last:border-0">
      <dt className="w-36 shrink-0 text-fg-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 break-all font-medium text-fg">{children}</dd>
    </div>
  );
}

function todayIso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

export function GeneralTab({ offer, advName, domains, base, onSaved }: {
  offer: Offer; advName: string; domains: TrackingDomain[]; base: string; onSaved: () => void;
}) {
  const goals = useQuery<Row[]>(`${base}/goals`);
  const activeDomains = domains.filter((d) => d.status === 'active');
  const primary = activeDomains.find((d) => d.isPrimary) ?? activeDomains[0];

  const [range, setRange] = useState({ from: todayIso(30), to: todayIso(0) });
  const statsPath = `/api/reports?offerId=${offer.id}&metrics=clicks,conversions,revenue,payout,margin,cr&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  const stats = useQuery<AggResult>(statsPath);
  const statsRow = stats.data?.rows[0]?.metrics;

  // Per-offer postback secure_code (overrides the network-wide code).
  const regenCode = useMutation(() => api.post<{ securityCode: string }>(`${base}/security-code/regenerate`));
  const clearCode = useMutation(() => api.del(`${base}/security-code`));
  const [codeOverride, setCodeOverride] = useState<string | null | undefined>(undefined);
  const offerCode = codeOverride !== undefined ? codeOverride : (offer.securityCode ?? null);
  const regenerateCode = async () => { const r = await regenCode.run(undefined); if (r) setCodeOverride(r.securityCode); };
  const removeCode = async () => { if (await clearCode.run(undefined)) setCodeOverride(null); };
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const trackBase = isLocal ? 'http://localhost:4002' : `https://${primary?.host ?? 'your-tracking-domain.com'}`;
  const postbackUrl = `${trackBase}/postback?click_id={click_id}&txn_id={txn_id}&secure_code=${offerCode ?? '{secure_code}'}`;

  const [note, setNote] = useState('');
  const saveNotes = useMutation((notes: string[]) => api.patch(base, { notes }));
  const notes = offer.notes ?? [];
  const addNote = async () => { if (note.trim() && await saveNotes.run([...notes, note.trim()])) { setNote(''); onSaved(); } };
  const removeNote = async (i: number) => { if (await saveNotes.run(notes.filter((_, j) => j !== i))) onSaved(); };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {/* Left column */}
      <div className="space-y-6">
        <Card title="General">
          <dl>
            <InfoRow label="ID">{offer.ref ?? '—'}</InfoRow>
            <InfoRow label="Name">{offer.name}</InfoRow>
            <InfoRow label="Advertiser"><span className="text-accent-text">{advName}</span></InfoRow>
            <InfoRow label="Category">{offer.category ?? '—'}</InfoRow>
            <InfoRow label="Currency">{offer.currency}</InfoRow>
            <InfoRow label="Status"><Badge value={offer.status} /></InfoRow>
            <InfoRow label="Description">{offer.description ?? '—'}</InfoRow>
            <InfoRow label="Modified">{offer.updatedAt ? new Date(offer.updatedAt).toLocaleString() : '—'}</InfoRow>
            <InfoRow label="Created">{new Date(offer.createdAt).toLocaleString()}</InfoRow>
          </dl>
        </Card>

        <Card title="Tracking">
          <dl>
            <InfoRow label="Default Landing Page URL"><span className="break-all font-mono text-tiny text-accent-text">{offer.destinationUrl}</span></InfoRow>
            <InfoRow label="Tracking Domain">{primary?.host ?? 'Default'}</InfoRow>
            <InfoRow label="Click Tracking Type">Redirect Linking</InfoRow>
            <InfoRow label="Support Deep Links"><span className="text-success-text">YES</span></InfoRow>
          </dl>
          <div className="mt-4 rounded-[var(--radius)] border border-border p-4">
            <p className="mb-2 text-small font-semibold text-fg">Conversion Tracking Method: Server To Server Postback</p>
            <p className="mb-3 text-tiny text-fg-secondary">The advertiser fires this postback on conversion, substituting the click id.</p>
            <CopyBox value={postbackUrl} />
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-small font-medium text-fg">Security code (secure_code)</p>
              <div className="flex gap-2">
                <button className="btn-ghost !px-3 !py-1 text-tiny" disabled={regenCode.busy} onClick={regenerateCode}>{regenCode.busy ? '…' : offerCode ? 'Regenerate' : 'Generate'}</button>
                {offerCode && <button className="btn-ghost !px-3 !py-1 text-tiny text-danger-text hover:bg-danger-bg" disabled={clearCode.busy} onClick={removeCode}>Remove</button>}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Notes">
          <textarea className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" />
          <button className="btn-primary mt-2 !py-1.5 !px-3 text-tiny" disabled={saveNotes.busy || !note.trim()} onClick={addNote}>+ Add Note</button>
          <div className="mt-3 space-y-2">
            {notes.length === 0 ? <p className="text-tiny text-fg-muted">No notes added yet.</p> : notes.map((n, i) => (
              <div key={i} className="flex items-start justify-between gap-2 rounded-[var(--radius)] border border-border p-2 text-small">
                <span className="min-w-0 break-words">{n}</span>
                <button className="shrink-0 text-fg-muted hover:text-danger-text" onClick={() => removeNote(i)}>×</button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Right column */}
      <div className="space-y-6">
        <Card title="Stats" action={
          <div className="flex items-center gap-2 text-tiny text-fg-secondary">
            <input type="date" className="input !w-auto !py-1 text-tiny" value={range.from.slice(0, 10)} onChange={(e) => setRange((r) => ({ ...r, from: new Date(e.target.value).toISOString() }))} />
            <span>to</span>
            <input type="date" className="input !w-auto !py-1 text-tiny" value={range.to.slice(0, 10)} onChange={(e) => setRange((r) => ({ ...r, to: new Date(e.target.value).toISOString() }))} />
          </div>
        }>
          {stats.loading ? <Spinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-small">
                <thead className="text-tiny uppercase text-fg-muted"><tr>
                  <th className="py-2 pr-4">Revenue</th><th className="py-2 pr-4">Payout</th><th className="py-2 pr-4">Margin</th>
                  <th className="py-2 pr-4">Clicks</th><th className="py-2 pr-4">CV</th><th className="py-2">CVR</th>
                </tr></thead>
                <tbody><tr className="font-semibold text-fg">
                  <td className="py-2 pr-4">{money(statsRow?.revenue)}</td>
                  <td className="py-2 pr-4">{money(statsRow?.payout)}</td>
                  <td className="py-2 pr-4">{money(statsRow?.margin)}</td>
                  <td className="py-2 pr-4">{num(statsRow?.clicks)}</td>
                  <td className="py-2 pr-4">{num(statsRow?.conversions)}</td>
                  <td className="py-2">{statsRow?.cr ?? 0}%</td>
                </tr></tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Revenue & Payout (Events)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-small">
              <thead className="text-tiny uppercase text-fg-muted"><tr><th className="py-2">Name</th><th className="py-2 text-right">Revenue</th><th className="py-2 text-right">Payout</th><th className="py-2 pl-4">Currency</th></tr></thead>
              <tbody className="divide-y divide-border">
                <tr><td className="py-2 font-medium">Base (Default)</td><td className="py-2 text-right">{offer.defaultRevenue}</td><td className="py-2 text-right">{offer.defaultPayout}</td><td className="py-2 pl-4">{offer.currency}</td></tr>
                {(goals.data ?? []).map((g) => (
                  <tr key={g.id}><td className="py-2 font-medium">{String(g.name)}</td><td className="py-2 text-right">{String(g.revenue)}</td><td className="py-2 text-right">{String(g.payout)}</td><td className="py-2 pl-4">{String(g.currency ?? offer.currency)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Offer URLs">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-small">
              <thead className="text-tiny uppercase text-fg-muted"><tr><th className="py-2">Name</th><th className="py-2">URL</th></tr></thead>
              <tbody><tr><td className="py-2 font-medium">Default</td><td className="max-w-xs truncate py-2 font-mono text-tiny text-accent-text">{offer.destinationUrl}</td></tr></tbody>
            </table>
          </div>
        </Card>

        <Card title="Caps & Control">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[380px] text-left text-small">
              <thead className="text-tiny uppercase text-fg-muted"><tr><th className="py-2">Type</th><th className="py-2 text-right">Daily</th><th className="py-2 text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-border">
                <tr><td className="py-2">Clicks</td><td className="py-2 text-right">{offer.dailyClickCap ?? '—'}</td><td className="py-2 text-right">—</td></tr>
                <tr><td className="py-2">Conversions</td><td className="py-2 text-right">{offer.dailyConversionCap ?? '—'}</td><td className="py-2 text-right">{offer.totalConversionCap ?? '—'}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-tiny text-fg-secondary">Visibility: <span className="font-medium capitalize text-fg">{offer.visibility ?? 'public'}</span> · Attribution window: <span className="font-medium text-fg">{offer.attributionWindowS ? `${Math.round(offer.attributionWindowS / 3600)}h` : '—'}</span></p>
        </Card>
      </div>
    </div>
  );
}
