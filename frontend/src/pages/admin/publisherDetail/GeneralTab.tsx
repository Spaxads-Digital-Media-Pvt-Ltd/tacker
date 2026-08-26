import { useState, type ReactNode } from 'react';
import { Badge, Spinner } from '../../../components/ui';
import { Icon } from '../../../components/icons';
import { useQuery } from '../../../lib/useApi';
import type { Publisher } from '../../../types';

interface AggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[] }
const money = (v: string | number | undefined) => `$${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0))}`;
const num = (v: string | number | undefined) => new Intl.NumberFormat('en-US').format(Number(v ?? 0));

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card !p-0">
      <div className="border-b border-border px-4 py-3"><h3 className="text-h3 font-medium text-fg">{title}</h3></div>
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

const MACRO_PARAMS = ['adv1', 'adv2', 'adv3', 'adv4', 'adv5'];

export function GeneralTab({ pub }: { pub: Publisher }) {
  const [range] = useState({ from: todayIso(30), to: todayIso(0) });
  const statsPath = `/api/reports?publisherId=${pub.id}&metrics=clicks,conversions,revenue,payout,margin,cr&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  const stats = useQuery<AggResult>(statsPath);
  const statsRow = stats.data?.rows[0]?.metrics;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Card title="General">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent-text">
              <Icon.manager width={28} height={28} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-h3 font-semibold text-fg">{pub.name}</p>
              <p className="text-tiny text-fg-secondary">Partner ID {pub.ref ?? '—'}</p>
            </div>
          </div>
          <dl>
            <InfoRow label="ID">{pub.ref ?? '—'}</InfoRow>
            <InfoRow label="Name">{pub.name}</InfoRow>
            <InfoRow label="Partner Manager">—</InfoRow>
            <InfoRow label="Account Executive">—</InfoRow>
            <InfoRow label="Status"><Badge value={pub.status} /></InfoRow>
            <InfoRow label="Contact Email">{pub.contactEmail ?? '—'}</InfoRow>
            <InfoRow label="Traffic Source">{pub.trafficSource ?? '—'}</InfoRow>
            <InfoRow label="Payout Terms">{pub.payoutTerms ?? '—'}</InfoRow>
            <InfoRow label="Modified">{pub.updatedAt ? new Date(pub.updatedAt).toLocaleString() : '—'}</InfoRow>
            <InfoRow label="Created">{new Date(pub.createdAt).toLocaleString()}</InfoRow>
          </dl>
        </Card>

        <Card title="Partner Referral Setting">
          <p className="text-small text-fg-muted">Referral links aren't configured for this network yet.</p>
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="Stats (last 30 days)">
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

        <Card title="Billing">
          <div className="grid grid-cols-1 gap-x-4 gap-y-0 sm:grid-cols-2">
            <InfoRow label="Billing Frequency">—</InfoRow>
            <InfoRow label="Auto Invoice">—</InfoRow>
            <InfoRow label="Payment Method">{pub.payoutTerms ?? '—'}</InfoRow>
            <InfoRow label="Payment Terms">—</InfoRow>
          </div>
          <p className="mt-2 text-tiny text-fg-muted">Detailed billing configuration isn't available yet.</p>
        </Card>

        <Card title="Macro Parameters Visibility">
          <p className="mb-2 text-tiny text-fg-muted">Note: sub1–sub10 are always visible by default.</p>
          <table className="w-full text-left text-small">
            <thead className="text-tiny uppercase text-fg-muted"><tr><th className="py-1.5">Parameter</th><th className="py-1.5">Visible?</th></tr></thead>
            <tbody className="divide-y divide-border">
              {MACRO_PARAMS.map((p) => (
                <tr key={p}><td className="py-1.5">{p}</td><td className="py-1.5 text-success-text">YES</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
