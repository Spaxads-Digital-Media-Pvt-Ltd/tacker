/**
 * Automation — Scheduled Actions, Alerts, and Webhooks wired via EmptyShellTable (same UI, real API).
 * Execution/delivery not wired yet.
 */
import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Tabs } from '../../components/ui';
import { EmptyShellTable, type ShellRow } from '../../components/EmptyShellTable';
import type { Offer, Publisher } from '../../types';

const TOP_TABS = ['Scheduled Actions', 'Alerts', 'Webhooks'] as const;

const SCHEDULED_ACTION_COLUMNS = [
  'ID', 'Type', 'Offers', 'Offer Groups', 'Partners', 'Creatives', 'Event',
  'Scheduled Time', 'Internal Notes', 'Created By', 'Created', 'Modified',
];
const ALERT_RULE_COLUMNS = ['ID', 'Name', 'Conditions', 'In App', 'Email', 'Created', 'Modified'];
const WEBHOOK_COLUMNS = ['Name', 'URL', 'Events', 'HTTP Method', 'Created', 'Modified'];

const TITLES: Record<string, string> = {
  'Scheduled Actions': 'Manage Scheduled Actions',
  Alerts: 'Manage Alerts',
  Webhooks: 'Manage Webhooks',
};

const ACTION_TYPES = new Set(['activate', 'pause', 'archive', 'cap_change']);

interface ScheduledAction {
  id: string; displayId: number | null;
  offerId: string; offerName: string | null; offerRef: number | null;
  actionType: string; partnerCount: number; event: string | null;
  scheduledTime: string | null; internalNotes: string | null;
  createdBy: string | null; createdAt: string; updatedAt: string;
}

interface AlertRule {
  id: string; ref: number; name: string; conditions: string;
  inApp: boolean; email: boolean;
  createdAt: string; updatedAt: string;
}

interface Webhook {
  id: string; name: string; events: string; httpMethod: string; url: string;
  createdAt: string; updatedAt: string;
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
type StatusFilter = 'All' | 'Active' | 'Inactive' | 'Deleted';

function scheduledStatusParam(filter: StatusFilter): string {
  if (filter === 'Active') return 'pending';
  if (filter === 'Inactive') return 'executed';
  if (filter === 'Deleted') return 'cancelled';
  return 'all';
}

function ruleStatusParam(filter: StatusFilter): string {
  if (filter === 'All') return 'all';
  return filter.toLowerCase();
}

function tabFromParam(raw: string | null): string {
  if (raw === 'webhooks') return 'Webhooks';
  if (raw === 'alerts') return 'Alerts';
  if (raw === 'scheduled-actions') return 'Scheduled Actions';
  return 'Scheduled Actions';
}

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function resolveOfferId(input: string, offers: Offer[]): string | null {
  const t = input.trim();
  if (!t) return null;
  if (/^[0-9a-f-]{36}$/i.test(t)) return t;
  const byRef = offers.find((o) => String(o.ref) === t);
  if (byRef) return byRef.id;
  const byName = offers.find((o) => o.name.toLowerCase() === t.toLowerCase());
  return byName?.id ?? null;
}

function resolvePartnerIds(input: string | undefined, publishers: Publisher[]): string[] {
  if (!input?.trim()) return [];
  return input.split(',').map((s) => s.trim()).filter(Boolean).map((token) => {
    if (/^[0-9a-f-]{36}$/i.test(token)) return token;
    const byRef = publishers.find((p) => String(p.ref) === token);
    if (byRef) return byRef.id;
    const byName = publishers.find((p) => p.name.toLowerCase() === token.toLowerCase());
    return byName?.id ?? '';
  }).filter(Boolean);
}

function ScheduledActionsPanel() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const { data, loading, refetch } = useQuery<ScheduledAction[]>(
    `/api/automation/scheduled-actions?status=${scheduledStatusParam(statusFilter)}`,
  );
  const { data: offers } = useQuery<Offer[]>('/api/offers?limit=200');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { run: runCreate } = useMutation((body: Record<string, unknown>) =>
    api.post('/api/automation/scheduled-actions', body));
  const { run: runDelete } = useMutation((id: string) =>
    api.del(`/api/automation/scheduled-actions/${id}`));

  const rows: ShellRow[] = (data ?? []).map((r) => ({
    id: r.id,
    cells: {
      ID: r.displayId != null ? String(r.displayId) : '—',
      Type: r.actionType.replace('_', ' '),
      Offers: r.offerName ? `${r.offerName} (#${r.offerRef})` : '—',
      'Offer Groups': '—',
      Partners: r.partnerCount > 0 ? String(r.partnerCount) : '—',
      Creatives: '—',
      Event: r.event ?? '—',
      'Scheduled Time': fmt(r.scheduledTime),
      'Internal Notes': r.internalNotes ?? '—',
      'Created By': r.createdBy ?? 'System',
      Created: fmt(r.createdAt),
      Modified: fmt(r.updatedAt),
    },
  }));

  return (
    <EmptyShellTable
      columns={SCHEDULED_ACTION_COLUMNS}
      addLabel="Action"
      status="All"
      statusFilter={statusFilter}
      onStatusFilterChange={(v) => setStatusFilter(v as StatusFilter)}
      rows={rows}
      loading={loading}
      onAddSubmit={async (v) => {
        const offerList = offers ?? [];
        const pubList = publishers ?? [];
        const offerId = resolveOfferId(v['Offers'] ?? '', offerList);
        if (!offerId) return false;
        const rawType = (v['Type']?.trim() || 'pause').toLowerCase().replace(/\s+/g, '_');
        const actionType = ACTION_TYPES.has(rawType) ? rawType : 'pause';
        const scheduledRaw = v['Scheduled Time']?.trim();
        const scheduledTime = scheduledRaw ? new Date(scheduledRaw).toISOString() : null;
        const ok = await runCreate({
          offerId,
          actionType,
          partnerIds: resolvePartnerIds(v['Partners'], pubList),
          event: v['Event']?.trim() || null,
          scheduledTime: scheduledTime && !Number.isNaN(Date.parse(scheduledTime)) ? scheduledTime : null,
          internalNotes: v['Internal Notes']?.trim() || null,
          status: 'pending',
        });
        if (ok) refetch();
        return !!ok;
      }}
      onDelete={async (id) => { if (await runDelete(id)) refetch(); }}
    />
  );
}

function AlertsPanel() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Active');
  const { data, loading, refetch } = useQuery<AlertRule[]>(
    `/api/automation/alert-rules?status=${ruleStatusParam(statusFilter)}`,
  );
  const { run: runCreate } = useMutation((body: Record<string, unknown>) =>
    api.post('/api/automation/alert-rules', body));
  const { run: runDelete } = useMutation((id: string) => api.del(`/api/automation/alert-rules/${id}`));

  const rows: ShellRow[] = (data ?? []).map((r) => ({
    id: r.id,
    cells: {
      ID: String(r.ref),
      Name: r.name,
      Conditions: r.conditions,
      'In App': r.inApp ? 'Yes' : 'No',
      Email: r.email ? 'Yes' : 'No',
      Created: fmt(r.createdAt),
      Modified: fmt(r.updatedAt),
    },
  }));

  return (
    <>
      <p className="mb-3 text-tiny text-fg-muted">
        Alert *rules* (conditions → notify) — not the fraud Alerts inbox at{' '}
        <Link to="/app/alerts" className="text-accent-text hover:underline">/app/alerts</Link>.
      </p>
      <EmptyShellTable
        columns={ALERT_RULE_COLUMNS}
        addLabel="Alert"
        status="Active"
        statusFilter={statusFilter}
        onStatusFilterChange={(v) => setStatusFilter(v as StatusFilter)}
        rows={rows}
        loading={loading}
        onAddSubmit={async (v) => {
          if (!v['Name']?.trim() || !v['Conditions']?.trim()) return false;
          const inApp = !v['In App'] || /yes|true|1/i.test(v['In App']);
          const email = /yes|true|1/i.test(v['Email'] ?? '');
          const ok = await runCreate({
            name: v['Name'].trim(),
            conditions: v['Conditions'].trim(),
            inApp,
            email,
            status: 'active',
          });
          if (ok) refetch();
          return !!ok;
        }}
        onDelete={async (id) => { if (await runDelete(id)) refetch(); }}
      />
    </>
  );
}

function WebhooksPanel() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Active');
  const { data, loading, error, refetch } = useQuery<Webhook[]>(
    `/api/automation/webhooks?status=${ruleStatusParam(statusFilter)}`,
  );
  const { run: runDelete } = useMutation((id: string) => api.del(`/api/automation/webhooks/${id}`));

  const rows: ShellRow[] = (data ?? []).map((r) => ({
    id: r.id,
    cells: {
      Name: r.name,
      Events: r.events || '—',
      'HTTP Method': r.httpMethod,
      URL: r.url,
      Created: fmt(r.createdAt),
      Modified: fmt(r.updatedAt),
    },
  }));

  return (
    <>
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      <EmptyShellTable
        columns={WEBHOOK_COLUMNS}
        addLabel="Webhook"
        status="Active"
        statusFilter={statusFilter}
        onStatusFilterChange={(v) => setStatusFilter(v as StatusFilter)}
        rows={rows}
        loading={loading}
        onAddSubmit={async (v) => {
          if (!v['Name']?.trim()) throw new Error('Name is required');
          if (!v['URL']?.trim()) throw new Error('URL is required');
          const url = normalizeUrl(v['URL']);
          const rawMethod = (v['HTTP Method']?.trim() || 'POST').toUpperCase();
          const httpMethod = HTTP_METHODS.has(rawMethod) ? rawMethod : 'POST';
          try {
            await api.post('/api/automation/webhooks', {
              name: v['Name'].trim(),
              events: v['Events']?.trim() || '',
              httpMethod,
              url,
              status: 'active',
            });
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'Save failed');
          }
          refetch();
          return true;
        }}
        onDelete={async (id) => { if (await runDelete(id)) refetch(); }}
      />
    </>
  );
}

export default function Automation() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<string>(() => tabFromParam(searchParams.get('tab')));

  const changeTab = (next: string) => {
    setTab(next);
    const slug = next === 'Webhooks' ? 'webhooks' : next === 'Alerts' ? 'alerts' : 'scheduled-actions';
    setSearchParams({ tab: slug }, { replace: true });
  };

  useEffect(() => {
    const fromUrl = tabFromParam(searchParams.get('tab'));
    if (fromUrl !== tab) setTab(fromUrl);
  }, [searchParams]);
  return (
    <>
      <PageHeader title={TITLES[tab] ?? tab} subtitle={`Automation › ${tab}`} />
      <Tabs tabs={[...TOP_TABS]} active={tab} onChange={changeTab} />
      {tab === 'Scheduled Actions' && <ScheduledActionsPanel />}
      {tab === 'Alerts' && <AlertsPanel />}
      {tab === 'Webhooks' && <WebhooksPanel />}
    </>
  );
}
