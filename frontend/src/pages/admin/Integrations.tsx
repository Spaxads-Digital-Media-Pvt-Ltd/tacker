/**
 * Integrations hub (Everflow-style): 11 category tabs, audited click-by-click against the live
 * reference (every tab's real vendor cards, action-button labels, and the two banners below — the
 * reference itself confirmed absent from any tab we hadn't yet checked). Media Buying (Pin API +
 * Facebook CAPI), Feeds (Offer Feed), and MMP are real — backed by /api/settings or a genuine setup
 * catalog. The other 8 categories (Fraud Detection, Suppression List, Billing, CRM, E-Commerce, Pay
 * Per Call, Email, E-Signature) have no backend concept at all, so they show an honest generic
 * "Not connected" placeholder rather than naming specific real vendors we have no relationship with
 * (the reference lists real companies like PayPal/IPQualityScore/24Metrics as if actively
 * integrated — Media Buying is the one exception, because Facebook CAPI there is a genuine
 * integration against Meta's real public Conversions API, not a fabricated relationship).
 *
 * Two real, reference-matched banners this app CAN honestly show, reusing infrastructure that
 * already exists elsewhere: CRM and E-Commerce both carry a real "Can't find the integration you
 * need? Try Zapier." banner on the reference — this app has no Zapier app, but it does have a real
 * public API + API key issuance (Control Center › Security, `/api/keys`), the actual prerequisite
 * for any such build-your-own integration, so the banner points there instead of naming Zapier.
 * Billing carries a real "Everflow Pay" native-payment upsell banner — this app has no payment
 * processor of its own, but it does have real Accounts Payable/Receivable invoice tracking already
 * built (Partner Invoices, Advertiser Invoices), which is the honest equivalent capability.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Search, Filter, MoreVertical, Pencil, ChevronRight, HelpCircle, Info, FileCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Tabs, StateBlock, Spinner, Modal } from '../../components/ui';
import { Accordion } from '../../components/Accordion';
import { Pagination } from '../../components/ReportPageKit';
import { ColumnsModal } from '../../components/TableActionsKit';
import {
  FraudDetectionTab, SuppressionListTab, BillingTab, CrmTab, ECommerceTab,
  PayPerCallTab, EmailTab, ESignatureTab, MmpTab, MediaBuyingEverflowTab,
} from './IntegrationsTabs';
import { downloadCsv, downloadXlsx } from '../../lib/export';

// Verified against the reference's real Configure pattern (24metrics detail page, Feed detail page):
// a read-only "General" summary with an "Edit" affordance, not a form dropped straight into view.
// Reused by every real integration below (Media Buying, Feeds) instead of jumping straight to inputs.
function GeneralSection({ fields, onEdit }: { fields: { label: string; value: ReactNode }[]; onEdit: () => void }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between border-b border-border pb-2.5">
        <h3 className="text-small font-semibold text-fg">General</h3>
        <button type="button" onClick={onEdit} className="flex items-center gap-1.5 text-tiny font-medium text-accent-text hover:underline">
          <Pencil size={12} /> Edit
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
        {fields.map((f) => (
          <div key={f.label}>
            <p className="text-tiny uppercase tracking-wide text-fg-muted">{f.label}</p>
            <p className="mt-0.5 text-small text-fg">{f.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const TABS = [
  'Fraud Detection', 'Suppression List', 'Billing', 'Media Buying', 'CRM', 'E-Commerce',
  'Pay Per Call', 'Email', 'MMP', 'E-Signature', 'Feeds',
] as const;

function BuildYourOwnBanner() {
  return (
    <div className="card mb-4 flex items-center justify-between gap-4">
      <p className="text-small text-fg-secondary">Can't find the integration you need? Generate an API key and build your own.</p>
      <Link to="/app/control-center/security" className="btn-ghost shrink-0">Get an API Key</Link>
    </div>
  );
}

function InvoicesBanner() {
  return (
    <div className="card mb-4 flex items-center justify-between gap-4">
      <p className="text-small text-fg-secondary">This app doesn't process payments directly, but it does track invoices — Accounts Payable for Partners, Accounts Receivable for Advertisers.</p>
      <div className="flex shrink-0 gap-2">
        <Link to="/app/aff-invoices" className="btn-ghost">Partner Invoices</Link>
        <Link to="/app/adv-invoices" className="btn-ghost">Advertiser Invoices</Link>
      </div>
    </div>
  );
}

export default function Integrations() {
  const [tab, setTab] = useState<string>('Fraud Detection');
  return (
    <>
      <PageHeader title="Manage Integrations" subtitle="Connect attribution platforms, payment providers, and offer feeds." />
      <Tabs tabs={[...TABS]} active={tab} onChange={setTab} />
      {(tab === 'CRM' || tab === 'E-Commerce') && <BuildYourOwnBanner />}
      {tab === 'Billing' && <InvoicesBanner />}
      {tab === 'Fraud Detection' && <FraudDetectionTab />}
      {tab === 'Suppression List' && <SuppressionListTab />}
      {tab === 'Billing' && <BillingTab />}
      {tab === 'Media Buying' && <MediaBuyingEverflowTab />}
      {tab === 'CRM' && <CrmTab />}
      {tab === 'E-Commerce' && <ECommerceTab />}
      {tab === 'Pay Per Call' && <PayPerCallTab />}
      {tab === 'Email' && <EmailTab />}
      {tab === 'MMP' && <MmpTab />}
      {tab === 'E-Signature' && <ESignatureTab />}
      {tab === 'Feeds' && <FeedsTab />}
    </>
  );
}

// ── Feeds: real (Offer Feed via /api/settings)
// "Add Integration" Setup wizard (Integration / Remote Offers / Offer Settings / Partner Settings /
// Controls). Its ~100-platform picker (Everflow, AppsFlyer-style networks, HasOffers, etc.) isn't
// replicated — same policy as every other tab, no fabricated vendor relationships — but step 1's own
// generic fields (Name, Status, Default Advertiser, Sync Frequency, API key) apply regardless of
// vendor and ARE honestly backable here: Default Advertiser reuses this network's real Advertiser
// records, and the rest persist through the same /api/settings/integrations freeform store already
// used elsewhere on this page. Configuring these now makes the Feeds table's own Name/Advertiser/Sync
// Frequency columns show real values instead of dashes, matching the reference's real row shape.
// Table Actions (Export CSV/Excel, Columns Customization) reuses the exact real TableActionsKit
// already wired into every other report page in this app — was previously an inert placeholder here.
const FEEDS_COLUMNS = ['ID', 'Name', 'Advertiser', 'Partner', 'Sync Frequency', 'Total Active Offers', 'Total Offers', 'Last Status Sync', 'Last Full Sync', 'Created', 'Modified'];
const SYNC_FREQUENCIES = ['As Soon As Possible', 'Hourly', 'Daily', 'Weekly'];

function HelpIcon({ text }: { text: string }) {
  return <span title={text} className="inline-flex shrink-0"><HelpCircle size={14} className="text-fg-muted" /></span>;
}

// Real per-vendor Setup form on the reference (confirmed live, e.g. "Libertap"): mandatory-fields
// banner, Name, a two-segment Active/Paused status control (not a dropdown), Default Advertiser next
// to a "Thumbnail" preview box, Sync Frequency, a "Using Advertiser Currency" checkbox, a divider,
// then the vendor's own credential section (there: "Token"; here: Feed URL/Feed API Key, since this
// is the one honest "Custom Feed" card rather than a named vendor). Reference's footer says "Next"
// because it's step 1 of 5 (Remote Offers/Offer Settings/Partner Settings/Controls follow) — this app
// has no real per-offer selection or partner-visibility model to back those steps, so the footer here
// honestly says "Save integration" instead of implying more steps that don't exist.
function FeedConfigForm({ cur, advertisers, onSaved, onCancel }: { cur: Record<string, unknown>; advertisers: { id: string; name: string }[]; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState((cur['offerFeedName'] as string) ?? '');
  const [status, setStatus] = useState((cur['offerFeedStatus'] as string) ?? 'active');
  const [advertiserId, setAdvertiserId] = useState((cur['offerFeedAdvertiserId'] as string) ?? '');
  const [syncFrequency, setSyncFrequency] = useState((cur['offerFeedSyncFrequency'] as string) ?? SYNC_FREQUENCIES[0]);
  const [useAdvertiserCurrency, setUseAdvertiserCurrency] = useState(Boolean(cur['offerFeedUseAdvertiserCurrency']));
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const { run, busy, error } = useMutation((values: Record<string, unknown>) => api.put('/api/settings/integrations', { values }));
  const urlSet = Boolean(cur['offerFeedUrl']);
  const keySet = Boolean(cur['offerFeedKey']);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const values: Record<string, unknown> = {
      offerFeedName: name, offerFeedStatus: status, offerFeedAdvertiserId: advertiserId,
      offerFeedSyncFrequency: syncFrequency, offerFeedUseAdvertiserCurrency: useAdvertiserCurrency,
    };
    if (url) values['offerFeedUrl'] = url;
    if (key) values['offerFeedKey'] = key;
    if (await run(values)) onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-2 text-small text-fg-secondary">
        <Info size={14} className="shrink-0 text-fg-muted" /> Fields with an asterisk (*) are mandatory.
      </div>
      {error && <p className="text-small text-danger-text">{error}</p>}

      <div>
        <label className="label mb-1 flex items-center gap-1.5">Name <span className="text-danger-text">*</span> <HelpIcon text="Shown as this integration's name in the Feeds table." /></label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>

      <div>
        <label className="label mb-1 block">Status <span className="text-danger-text">*</span></label>
        <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
          {(['active', 'paused'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)}
              className={`flex flex-1 items-center justify-center gap-2 py-2 text-small font-medium ${status === s ? 'bg-surface text-fg' : 'bg-page text-fg-secondary'}`}>
              <span className={`h-2 w-2 rounded-full ${s === 'active' ? 'bg-success' : 'bg-warning'}`} />
              {s === 'active' ? 'Active' : 'Paused'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="label mb-1 block">Default Advertiser <span className="text-danger-text">*</span></label>
            <select className="input" value={advertiserId} onChange={(e) => setAdvertiserId(e.target.value)} required>
              <option value="">Select Default Advertiser…</option>
              {advertisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label mb-1 flex items-center gap-1.5">Sync Frequency <span className="text-danger-text">*</span> <HelpIcon text="How often this feed would refresh." /></label>
            <select className="input" value={syncFrequency} onChange={(e) => setSyncFrequency(e.target.value)}>
              {SYNC_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-small text-fg">
            <input type="checkbox" className="chk" checked={useAdvertiserCurrency} onChange={(e) => setUseAdvertiserCurrency(e.target.checked)} />
            Using Advertiser Currency <HelpIcon text="Report this feed's payouts in the default advertiser's currency." />
          </label>
        </div>
        <div>
          <label className="label mb-1 block">Thumbnail</label>
          <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-border">
            <FileCheck size={22} className="text-fg-muted" />
            <span className="text-small font-medium text-fg">Custom Feed</span>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-3 text-small font-semibold text-fg">Custom Feed</h3>
        <div className="space-y-3">
          <div>
            <label className="label mb-1 block">Feed URL <span className="text-danger-text">*</span>{urlSet ? <span className="text-fg-muted"> (set — leave blank to keep)</span> : null}</label>
            <input className="input" value={url} placeholder={urlSet ? '••••••••' : 'https://… or demo://offer-feed'} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block">Feed API Key <span className="text-danger-text">*</span>{keySet ? <span className="text-fg-muted"> (set — leave blank to keep)</span> : null}</label>
            <input className="input" type="password" value={key} placeholder={keySet ? '••••••••' : ''} onChange={(e) => setKey(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save integration'}</button>
      </div>
    </form>
  );
}

// The reference's "Add Advertiser Feed" step is a full-page grid of ~100 real platform cards
// (Everflow, AppLift, HasOffers, Papaya, …) each with a logo, "View Supported Features" link, and a
// "Setup" button. This app has no relationship with any of them and no vendor-specific integration
// logic behind any one of them — only ever one generic feed config regardless of which card you'd
// pick — so naming them would be exactly the fabricated-vendor problem this whole page otherwise
// avoids. What IS honestly reusable is the real STRUCTURE (a searchable card grid, each card a logo
// box + name + "Setup" button) — kept here with a single real, honestly-labeled "Custom Feed" card
// rather than either faking ~100 vendors or silently dropping the step the reference actually has.
function AddFeedGrid({ q, onQ, onSetup }: { q: string; onQ: (v: string) => void; onSetup: () => void }) {
  const cards = [{ name: 'Custom Feed', desc: 'Pull offers into this network from any feed URL you control.' }]
    .filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div>
      <div className="relative mb-4">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input className="input !pl-8" placeholder="Search…" value={q} onChange={(e) => onQ(e.target.value)} autoFocus />
      </div>
      {cards.length === 0 ? <p className="py-6 text-center text-small text-fg-muted">No integrations match "{q}".</p> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map((c) => (
            <div key={c.name} className="rounded-card border border-border p-4">
              <div className="mb-8 grid h-10 w-10 place-items-center rounded-[var(--radius)] bg-accent-subtle text-small font-bold text-accent-text">{c.name[0]}</div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="font-semibold text-fg">{c.name}</p>
                  <p className="text-tiny text-fg-muted">{c.desc}</p>
                </div>
                <button type="button" className="btn-primary shrink-0" onClick={onSetup}>Setup</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatSyncTime(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function FeedsTab() {
  const { data, loading, refetch } = useQuery<{ integrations: Record<string, unknown> }>('/api/settings');
  const { data: advertisers } = useQuery<{ id: string; name: string }[]>('/api/advertisers');
  const { run: runSync, busy: syncing, error: syncError } = useMutation((_v: Record<string, never>) => api.post('/api/settings/integrations/offer-feed/sync', {}));
  const [configOpen, setConfigOpen] = useState(false);
  const [step, setStep] = useState<'grid' | 'form' | 'summary'>('grid');
  const [gridQuery, setGridQuery] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const tableActionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tableActionsOpen) return;
    const onDown = (e: MouseEvent) => { if (!tableActionsRef.current?.contains(e.target as Node)) { setTableActionsOpen(false); setExportOpen(false); } };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [tableActionsOpen]);

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  const cur = data?.integrations ?? {};
  const url = cur['offerFeedUrl'] as string | undefined;
  const connected = Boolean(url);
  const advertiserId = cur['offerFeedAdvertiserId'] as string | undefined;
  const advertiserName = (advertisers ?? []).find((a) => a.id === advertiserId)?.name;
  const paused = cur['offerFeedStatus'] === 'paused';
  const shown = new Set(FEEDS_COLUMNS.filter((c) => !hiddenColumns.has(c)));
  const feedName = (cur['offerFeedName'] as string) || 'Offer Feed';
  const pulledToday = Number(cur['offerFeedPulledToday'] ?? 0);
  const pulledMonth = Number(cur['offerFeedPulledMonth'] ?? 0);
  const pulledTotal = Number(cur['offerFeedPulledTotal'] ?? 0);
  const totalActive = cur['offerFeedTotalActiveOffers'] != null ? String(cur['offerFeedTotalActiveOffers']) : '—';
  const totalOffers = cur['offerFeedTotalOffers'] != null ? String(cur['offerFeedTotalOffers']) : '—';
  const lastStatusSync = formatSyncTime(cur['offerFeedLastStatusSync'] as string | undefined);
  const lastFullSync = formatSyncTime(cur['offerFeedLastFullSync'] as string | undefined);
  const createdAt = formatSyncTime(cur['offerFeedCreatedAt'] as string | undefined);
  const modifiedAt = formatSyncTime(cur['offerFeedModifiedAt'] as string | undefined);
  const lastSyncError = cur['offerFeedLastSyncError'] as string | undefined;

  const rowMatchesSearch = !tableSearch.trim() || feedName.toLowerCase().includes(tableSearch.trim().toLowerCase())
    || (advertiserName ?? '').toLowerCase().includes(tableSearch.trim().toLowerCase());
  const rowMatchesStatus = statusFilter === 'all' || (statusFilter === 'paused' ? paused : !paused);
  const showRow = connected && rowMatchesSearch && rowMatchesStatus;

  const handleSync = async () => {
    if (await runSync({})) refetch();
  };

  const openModal = () => { setConfigOpen(true); setGridQuery(''); setStep(connected ? 'summary' : 'grid'); };
  const modalTitle = step === 'grid' ? 'Add Advertiser Feed' : 'Offer Feed';
  const exportRows = () => showRow ? [{
    ID: 1, Name: feedName, Advertiser: advertiserName ?? '', Partner: '',
    'Sync Frequency': (cur['offerFeedSyncFrequency'] as string) ?? '', 'Total Active Offers': totalActive, 'Total Offers': totalOffers,
    'Last Status Sync': lastStatusSync, 'Last Full Sync': lastFullSync, Created: createdAt, Modified: modifiedAt,
  }] : [];

  return (
    <div className="space-y-4">
      <Accordion title="Summary" defaultOpen>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div><p className="text-tiny uppercase text-fg-muted">Integrations</p><p className="mt-1 text-h3 font-semibold text-fg">{connected ? 1 : 0}</p></div>
          <div><p className="text-tiny uppercase text-fg-muted">Offers Pulled Today</p><p className="mt-1 text-h3 font-semibold text-fg">{pulledToday}</p></div>
          <div><p className="text-tiny uppercase text-fg-muted">Offers Pulled This Month</p><p className="mt-1 text-h3 font-semibold text-fg">{pulledMonth}</p></div>
          <div><p className="text-tiny uppercase text-fg-muted">Total Offers Pulled</p><p className="mt-1 text-h3 font-semibold text-fg">{pulledTotal}</p></div>
        </div>
        {lastSyncError && connected && (
          <p className="mt-3 text-small text-danger-text">Last sync error: {lastSyncError}</p>
        )}
      </Accordion>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={openModal}>+ {connected ? 'Configure' : 'Add'} Integration</button>
          {connected && (
            <button type="button" className="btn-ghost" onClick={() => void handleSync()} disabled={syncing || paused}>
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
          )}
        </div>
        {syncError && <p className="text-small text-danger-text">{syncError}</p>}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input placeholder="Search…" className="input !w-48 !pl-8" value={tableSearch} onChange={(e) => setTableSearch(e.target.value)} />
          </div>
          <select className="input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'paused')}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
          <button type="button" title="Filter by status" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg" onClick={() => setStatusFilter('active')}><Filter size={15} /></button>
          <div ref={tableActionsRef} className="relative">
            <button type="button" title="Table Actions" onClick={() => setTableActionsOpen((o) => !o)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
            {tableActionsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                <div className="px-3 py-1 text-tiny font-semibold uppercase text-fg-secondary">Table Actions</div>
                <div className="relative" onMouseEnter={() => setExportOpen(true)} onMouseLeave={() => setExportOpen(false)}>
                  <button onClick={() => setExportOpen((s) => !s)} className="flex w-full items-center justify-between px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
                    Export <ChevronRight size={13} className="text-fg-muted" />
                  </button>
                  {exportOpen && (
                    <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                      <button onClick={() => { downloadCsv('feeds.csv', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">CSV</button>
                      <button onClick={() => { downloadXlsx('feeds.xlsx', exportRows()); setTableActionsOpen(false); setExportOpen(false); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Excel</button>
                    </div>
                  )}
                </div>
                <button onClick={() => { setTableActionsOpen(false); setShowColumns(true); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">Columns Customization</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[900px] text-left text-body">
          <thead className="bg-page text-small font-semibold text-fg-secondary">
            <tr>{FEEDS_COLUMNS.filter((c) => shown.has(c)).map((c) => <th key={c} className="whitespace-nowrap px-4 py-3">{c}</th>)}</tr>
          </thead>
          <tbody>
            {!showRow ? (
              <tr><td colSpan={shown.size} className="px-4 py-10 text-center text-small italic text-fg-muted">{connected ? 'No records match your filters' : 'No Record Found'}</td></tr>
            ) : (
              <tr className="border-t border-border">
                {shown.has('ID') && <td className="px-4 py-3 text-fg-secondary">1</td>}
                {shown.has('Name') && (
                  <td className="px-4 py-3">
                    <button type="button" onClick={openModal} className="flex items-center gap-2 font-medium text-fg hover:text-accent-text">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${paused ? 'bg-fg-muted' : 'bg-success'}`} />
                      {feedName}
                    </button>
                  </td>
                )}
                {shown.has('Advertiser') && (
                  <td className="px-4 py-3 text-fg-secondary">
                    {advertiserId && advertiserName ? <Link to={`/app/advertisers/${advertiserId}`} className="text-accent-text hover:underline">{advertiserName}</Link> : '—'}
                  </td>
                )}
                {shown.has('Partner') && <td className="px-4 py-3 text-fg-muted">—</td>}
                {shown.has('Sync Frequency') && <td className="px-4 py-3 text-fg-secondary">{(cur['offerFeedSyncFrequency'] as string) ?? '—'}</td>}
                {shown.has('Total Active Offers') && <td className="px-4 py-3 text-fg-secondary">{totalActive}</td>}
                {shown.has('Total Offers') && <td className="px-4 py-3 text-fg-secondary">{totalOffers}</td>}
                {shown.has('Last Status Sync') && <td className="px-4 py-3 text-fg-secondary">{lastStatusSync}</td>}
                {shown.has('Last Full Sync') && <td className="px-4 py-3 text-fg-secondary">{lastFullSync}</td>}
                {shown.has('Created') && <td className="px-4 py-3 text-fg-secondary">{createdAt}</td>}
                {shown.has('Modified') && <td className="px-4 py-3 text-fg-secondary">{modifiedAt}</td>}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {showColumns && <ColumnsModal allColumns={FEEDS_COLUMNS} order={[...FEEDS_COLUMNS]} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={(_o, h) => setHiddenColumns(h)} />}
      <div className="flex justify-end">
        <Pagination total={showRow ? 1 : 0} page={1} pageSize={25} onPageChange={() => {}} />
      </div>

      <Modal open={configOpen} onClose={() => setConfigOpen(false)} title={modalTitle}>
        {step === 'grid' ? (
          <AddFeedGrid q={gridQuery} onQ={setGridQuery} onSetup={() => setStep('form')} />
        ) : step === 'form' ? (
          <FeedConfigForm cur={cur} advertisers={advertisers ?? []} onSaved={() => { setConfigOpen(false); refetch(); }} onCancel={() => setConfigOpen(false)} />
        ) : (
          <>
            <GeneralSection onEdit={() => setStep('form')} fields={[
              { label: 'Name', value: feedName },
              { label: 'Status', value: paused ? 'Paused' : 'Active' },
              { label: 'Sync Frequency', value: (cur['offerFeedSyncFrequency'] as string) || '—' },
              { label: 'Default Advertiser', value: advertiserName ?? '—' },
              { label: 'Feed URL', value: url ?? '—' },
              { label: 'Feed API Key', value: cur['offerFeedKey'] ? '••••••••' : '—' },
              { label: 'Last Full Sync', value: lastFullSync },
              { label: 'Total Offers', value: totalOffers },
            ]} />
            <div className="mt-4 flex justify-end">
              <button type="button" className="btn-ghost" onClick={() => void handleSync()} disabled={syncing || paused}>
                {syncing ? 'Syncing…' : 'Sync Now'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
