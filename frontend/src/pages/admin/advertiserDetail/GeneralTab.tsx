import { useState, type ReactNode } from 'react';
import { Badge, Spinner } from '../../../components/ui';
import { PostbackTester } from '../../../components/PostbackTester';
import { useQuery } from '../../../lib/useApi';
import type { Advertiser } from '../../../types';

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

export function GeneralTab({ adv, base }: { adv: Advertiser; base: string }) {
  const [range] = useState({ from: todayIso(30), to: todayIso(0) });
  const statsPath = `/api/reports?advertiserId=${adv.id}&metrics=clicks,conversions,revenue,payout,margin,cr&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  const stats = useQuery<AggResult>(statsPath);
  const statsRow = stats.data?.rows[0]?.metrics;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Card title="General">
          <dl>
            <InfoRow label="ID">{adv.ref ?? '—'}</InfoRow>
            <InfoRow label="Name">{adv.name}</InfoRow>
            <InfoRow label="Account Manager">—</InfoRow>
            <InfoRow label="Status"><Badge value={adv.status} /></InfoRow>
            <InfoRow label="Currency">{adv.defaultCurrency}</InfoRow>
            <InfoRow label="Contact Email">{adv.contactEmail ?? '—'}</InfoRow>
            <InfoRow label="Billing Terms">{adv.billingTerms ?? '—'}</InfoRow>
            <InfoRow label="Modified">{adv.updatedAt ? new Date(adv.updatedAt).toLocaleString() : '—'}</InfoRow>
            <InfoRow label="Created">{new Date(adv.createdAt).toLocaleString()}</InfoRow>
          </dl>
        </Card>

        <Card title="Advertiser Postback">
          <PostbackTester
            testPath={`${base}/debug-postback`}
            hint="Fire the advertiser's conversion postback URL with sample macros to verify it responds. No conversion is recorded."
          />
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
      </div>
    </div>
  );
}
