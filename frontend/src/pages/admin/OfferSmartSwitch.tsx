/**
 * Offers › SmartSwitch (D8) — rules that watch each partner's traffic on each offer and act on it.
 * The automation worker runs active rules every 5 minutes (api-backend lib/automation/smartswitch.ts):
 * conditions in the Automation grammar ("cr < 0.5 AND clicks >= 200 in 24h") are checked per
 * partner × offer in the rule's scope, and where they hold the action runs once — Notify, Block the
 * partner on the offer, Redirect their traffic to a URL, or Set their payout — after the Action Delay
 * if one is set. Every action raises an alert, emails admins / managers, and is in History. Preview
 * shows what a rule would act on right now without changing anything.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Tabs, Badge, Spinner, StateBlock, Table, Modal, type Column } from '../../shared-components/primitives/ui';
import { CollectionTab, type FieldDef } from '../../shared-components/panels/CollectionTab';
import type { Advertiser, Offer, Publisher } from '../../types';

type Row = { id: string; [k: string]: unknown };
const col = (header: string, cell: (r: Row) => ReactNode): Column<Row> => ({ header, cell });
const fmt = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : '—');
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

const TABS = ['Rules', 'History'] as const;

const ACTION_LABEL: Record<string, string> = {
  notify: 'Notify', block: 'Block partner on the offer', redirect: 'Redirect their traffic', payout: "Set the partner's payout",
};
const actionText = (r: Row) => {
  const a = String(r.action);
  if (a === 'redirect') return `Redirect → ${String(r.redirectUrl ?? '')}`;
  if (a === 'payout') return `Payout → ${String(r.payout ?? '')}`;
  return ACTION_LABEL[a] ?? a;
};
const scopeText = (r: Row) => {
  const parts = [['offer', list(r.offerIds).length], ['advertiser', list(r.advertiserIds).length], ['partner', list(r.partnerIds).length]] as const;
  const chosen = parts.filter(([, n]) => n > 0).map(([what, n]) => `${n} ${what}${n === 1 ? '' : 's'}`);
  return chosen.length ? chosen.join(' · ') : 'All offers and partners';
};

function Note({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-card border border-border bg-page px-3 py-2 text-[11px] text-fg-muted">{children}</div>;
}

const entOpts = <T extends { id: string; name: string; ref?: number }>(rows: T[] | null | undefined) =>
  (rows ?? []).map((r) => ({ value: r.id, label: r.ref != null ? `${r.name} (${r.ref})` : r.name }));

function useRuleFields(): FieldDef[] {
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  return useMemo<FieldDef[]>(() => [
    { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Block partners with a very low CR' },
    { key: 'conditions', label: 'Conditions (checked for each partner on each offer)', type: 'textarea', placeholder: 'cr < 0.5 AND clicks >= 200 in 24h' },
    { key: 'action', label: 'Action', type: 'select', options: Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label })), default: 'notify', required: true },
    { key: 'redirectUrl', label: 'Send their traffic to (URL)', type: 'url', placeholder: 'https://…', showIf: (f) => f['action'] === 'redirect' },
    { key: 'payout', label: 'New payout (per conversion)', type: 'money', placeholder: 'e.g. 1.50', showIf: (f) => f['action'] === 'payout' },
    { key: 'actionDelay', label: 'Action Delay (the conditions must hold this long first)', type: 'duration' },
    { key: 'offerIds', label: 'Offers (empty = all)', type: 'multiselect', options: entOpts(offers), placeholder: 'Type to search offers…' },
    { key: 'advertiserIds', label: "Advertisers' offers (empty = all)", type: 'multiselect', options: entOpts(advertisers), placeholder: 'Type to search advertisers…' },
    { key: 'partnerIds', label: 'Partners (empty = all)', type: 'multiselect', options: entOpts(publishers), placeholder: 'Type to search partners…' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused'], default: 'active' },
  ], [offers, advertisers, publishers]);
}

interface PreviewPair { offerId: string; offerName: string | null; publisherId: string; partnerName: string | null; values: Record<string, number | string> }
interface PreviewResult { windowMinutes: number; total: number; pairs: PreviewPair[] }

/** What a saved rule would act on right now — nothing changes. */
function PreviewModal({ rule, onClose }: { rule: Row; onClose: () => void }) {
  const [preview, setPreview] = useState<{ busy: boolean; error: string | null; result: PreviewResult | null }>({ busy: true, error: null, result: null });
  useEffect(() => {
    let live = true;
    api.post<PreviewResult>('/api/smartswitch/preview', {
      action: rule.action, conditions: rule.conditions ?? null, actionDelay: rule.actionDelay ?? null,
      redirectUrl: rule.redirectUrl ?? null, payout: rule.payout ?? null,
      offerIds: list(rule.offerIds), advertiserIds: list(rule.advertiserIds), partnerIds: list(rule.partnerIds),
    }).then((result) => { if (live) setPreview({ busy: false, error: null, result }); })
      .catch((e: unknown) => { if (live) setPreview({ busy: false, error: e instanceof Error ? e.message : 'Preview failed', result: null }); });
    return () => { live = false; };
  }, [rule]);
  const { result } = preview;
  const pct = (v: unknown) => `${Number(v ?? 0).toFixed(2)}%`;
  return (
    <Modal open onClose={onClose} size="xl" title={`Preview “${String(rule.name)}”`} footer={<button type="button" className="btn-ghost" onClick={onClose}>Close</button>}>
      {preview.busy ? <StateBlock><Spinner /></StateBlock>
        : preview.error ? <p className="text-small text-danger-text">{preview.error}</p>
        : result && (
          <div className="space-y-3">
            <p className="text-small text-fg-secondary">
              {result.total === 0 ? 'Right now no partner on any offer in scope meets the conditions — the rule would do nothing.'
                : `Right now ${result.total} partner / offer pair${result.total === 1 ? '' : 's'} meet${result.total === 1 ? 's' : ''} the conditions — the rule would act on ${result.total === 1 ? 'it' : 'them'}: ${ACTION_LABEL[String(rule.action)] ?? rule.action}${rule.actionDelay ? ` (after ${String(rule.actionDelay)})` : ''}. Nothing has changed.`}
            </p>
            {result.pairs.length > 0 && (
              <Table<PreviewPair & { id: string }>
                columns={[
                  { header: 'Partner', cell: (p) => p.partnerName ?? p.publisherId },
                  { header: 'Offer', cell: (p) => p.offerName ?? p.offerId },
                  { header: 'Clicks', className: 'text-right', cell: (p) => String(p.values['clicks'] ?? 0) },
                  { header: 'Conv.', className: 'text-right', cell: (p) => String(p.values['conversions'] ?? 0) },
                  { header: 'CR', className: 'text-right', cell: (p) => pct(p.values['cr']) },
                  { header: 'Invalid', className: 'text-right', cell: (p) => pct(p.values['invalid_rate']) },
                ]}
                rows={result.pairs.map((p) => ({ ...p, id: `${p.offerId}:${p.publisherId}` }))} rowKey={(p) => p.id} />
            )}
            {result.total > result.pairs.length && <p className="text-tiny text-fg-muted">Showing the first {result.pairs.length} of {result.total}.</p>}
          </div>
        )}
    </Modal>
  );
}

function RulesPanel() {
  const ruleFields = useRuleFields();
  const { data: counts } = useQuery<Record<string, number>>('/api/smartswitch/rules/action-counts');
  const [previewing, setPreviewing] = useState<Row | null>(null);
  const columns = useMemo<Column<Row>[]>(() => [
    col('Name', (r) => <span className="font-medium text-fg">{String(r.name)}</span>),
    col('Conditions', (r) => (r.conditions ? <span className="font-mono text-tiny">{String(r.conditions)}</span> : <span className="text-fg-muted">— (draft)</span>)),
    col('Action', (r) => actionText(r)),
    col('Delay', (r) => (r.actionDelay ? String(r.actionDelay) : '—')),
    col('Scope', (r) => scopeText(r)),
    col('Status', (r) => <Badge value={String(r.status)} />),
    col('Last run', (r) => (r.lastError
      ? <span className="text-danger-text" title={String(r.lastError)}>{fmt(r.lastEvaluatedAt)} — {String(r.lastError)}</span>
      : fmt(r.lastEvaluatedAt))),
    col('Actions taken', (r) => <span className="tabular-nums">{counts?.[r.id] ?? 0}</span>),
    col('Last action', (r) => fmt(r.lastFiredAt)),
  ], [counts]);
  return (
    <>
      <Note>
        <p>
          Active rules run every 5 minutes. A rule looks at <strong>each partner on each offer</strong> in its scope over its window and,
          where the conditions hold, acts once: <strong>Notify</strong> (an alert), <strong>Block</strong> the partner on that offer,
          <strong> Redirect</strong> their traffic on it to a URL (an Offer Custom Setting › Landing Page), or <strong>Set their payout</strong> on it.
          With an Action Delay the conditions must keep holding that long first. Every action raises an alert, emails the network’s admins and
          managers, and is listed in History; a block / redirect / payout stays until someone changes it. Use <strong>Preview</strong> to see what a
          rule would act on right now.
        </p>
        <p className="mt-1.5">
          Conditions: one to five <span className="font-mono">metric op number</span> joined by AND — metrics clicks, unique_clicks, conversions,
          invalid_clicks, cr (%), invalid_rate (%), payout, revenue, margin, epc; ops &gt; &gt;= &lt; &lt;= = != — and an optional window
          “in 30m / 6h / 7d” (default 24h). Any action other than Notify needs a minimum volume, e.g. <span className="font-mono">AND clicks &gt;= 100</span>.
          At most 25 actions per rule per run.
        </p>
      </Note>
      <CollectionTab
        basePath="/api/smartswitch/rules"
        addLabel="New Rule"
        emptyText="No SmartSwitch rules yet."
        editable
        searchKeys={['name', 'conditions', 'action']}
        searchPlaceholder="Search by name or conditions…"
        fields={ruleFields}
        columns={columns}
        rowActions={(row) => (
          <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setPreviewing(row)}>Preview</button>
        )}
      />
      {previewing && <PreviewModal rule={previewing} onClose={() => setPreviewing(null)} />}
    </>
  );
}

const HISTORY_KINDS = [['', 'Everything'], ['action', 'Actions taken'], ['change', 'Rule edits']] as const;

function HistoryPanel() {
  const [kind, setKind] = useState<'' | 'action' | 'change'>('');
  const { data, loading, error } = useQuery<Row[]>(`/api/smartswitch/history${kind ? `?kind=${kind}` : ''}`);
  const columns: Column<Row>[] = [
    col('When', (r) => fmt(r.createdAt)),
    col('Rule', (r) => <span className="font-medium text-fg">{String(r.ruleName)}</span>),
    col('Type', (r) => <Badge value={r.kind === 'action' ? 'action' : 'edit'} />),
    col('What happened', (r) => String(r.change)),
    // N2: by name — actions are SmartSwitch's own.
    col('By', (r) => (r.kind === 'action' ? 'SmartSwitch' : r.employeeName ? String(r.employeeName) : r.employee ? 'Unknown user' : 'System')),
  ];
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <label className="text-tiny text-fg-secondary" htmlFor="ss-history-kind">Show</label>
        <select id="ss-history-kind" className="input !w-auto" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {HISTORY_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>Nothing yet.</StateBlock>
        : <Table columns={columns} rows={data} rowKey={(r) => r.id} />}
    </>
  );
}

export default function OfferSmartSwitch() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Rules');
  return (
    <>
      <PageHeader title="SmartSwitch" subtitle="Offers › SmartSwitch" />
      <Tabs tabs={[...TABS]} active={tab} onChange={(t) => setTab(t as (typeof TABS)[number])} />
      {tab === 'Rules' ? <RulesPanel /> : <HistoryPanel />}
    </>
  );
}
