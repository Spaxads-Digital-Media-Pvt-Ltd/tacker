/**
 * Control Center › Partners — network-wide partner-facing config (sign-up form, dashboard cards,
 * referral program, terms & conditions). No backend concept exists for any of this, so it's an
 * honest static/shell replica of the reference's structure.
 */
import { useEffect, useState } from 'react';
import { Pencil, Info } from 'lucide-react';
import { cc } from '../../../lib/controlCenter';
import { useQuery, useMutation } from '../../../lib/useApi';
import { Tabs, Field } from '../../../components/ui';
import { EmptyShellTable } from '../../../components/EmptyShellTable';
import { InfoCard, InfoGrid, InfoRow, NotificationCard, InfoBanner, HeadsUpBanner, YesNoToggle, HelpIcon, type NotifyDef } from './shared';

const SUB_TABS = ['General', 'Default Notifications', 'Partner Referral', 'Terms & Conditions'] as const;

/** Matches the reference's own "Edit Partner Portal" form: a plain checkbox for Hide Total Click, a
 * single Yes/No pill for Show Account Manager Details that reveals a nested sub-toggle when Yes, and
 * two HTML textareas each with an (inert — no macro engine in this app) "Add Macro" button. */
function EditGeneralPortalForm({ initial, onCancel, onSave }: {
  initial: Record<string, unknown>; onCancel: () => void; onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [hideTotalClick, setHideTotalClick] = useState(Boolean(initial['hideTotalClick']));
  const [showAcctMgr, setShowAcctMgr] = useState(initial['showAccountManagerDetails'] !== false);
  const [showAcctMgrCustom, setShowAcctMgrCustom] = useState(Boolean(initial['showAccountManagerCustomDetails']));
  const [headerHtml, setHeaderHtml] = useState(String(initial['htmlCustomHeader'] ?? ''));
  const [footerHtml, setFooterHtml] = useState(String(initial['htmlCustomFooter'] ?? ''));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        hideTotalClick, showAccountManagerDetails: showAcctMgr,
        showAccountManagerCustomDetails: showAcctMgrCustom,
        htmlCustomHeader: headerHtml, htmlCustomFooter: footerHtml,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-tiny text-fg-secondary"><Info size={13} className="text-fg-muted" /> Fields with an asterisk (*) are mandatory.</p>
      <div>
        <label className="label mb-2 block">Hide Total Click</label>
        <input type="checkbox" checked={hideTotalClick} onChange={(e) => setHideTotalClick(e.target.checked)} className="h-4 w-4 rounded border-border" />
      </div>
      <div>
        <label className="label mb-2 block">Show Account Manager Details</label>
        <YesNoToggle value={showAcctMgr} onChange={setShowAcctMgr} />
        {showAcctMgr && (
          <div className="mt-3 max-w-md rounded-card border border-border bg-page p-3">
            <label className="label mb-2 block">Show Account Manager Custom Details</label>
            <YesNoToggle value={showAcctMgrCustom} onChange={setShowAcctMgrCustom} />
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="label">HTML Custom Header (Left menu)</label>
          <button title="Not available yet" className="flex items-center gap-1 rounded-[var(--radius)] border border-border px-2 py-1 text-tiny font-medium text-fg-secondary hover:bg-page">{'{ }'} Add Macro</button>
        </div>
        <textarea rows={4} className="input w-full" value={headerHtml} onChange={(e) => setHeaderHtml(e.target.value)} />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="label flex items-center gap-1.5">HTML Custom Footer (Left menu) <HelpIcon text="Rendered in the left navigation footer across the Partner portal." /></label>
          <button title="Not available yet" className="flex items-center gap-1 rounded-[var(--radius)] border border-border px-2 py-1 text-tiny font-medium text-fg-secondary hover:bg-page">{'{ }'} Add Macro</button>
        </div>
        <textarea rows={4} className="input w-full" value={footerHtml} onChange={(e) => setFooterHtml(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function GeneralPortalCard() {
  const { data: config, refetch } = useQuery<Record<string, unknown>>('/api/control-center/config/partners');
  const portal = (config?.portal as Record<string, unknown> | undefined) ?? {};
  const [editing, setEditing] = useState(false);
  const saveMut = useMutation((body: Record<string, unknown>) => cc.putConfig('partners', { portal: body }));

  const save = async (body: Record<string, unknown>) => {
    const ok = await saveMut.run(body);
    if (ok) { setEditing(false); refetch(); }
    return !!ok;
  };

  return (
    <InfoCard title="General" action={editing ? <span /> : <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => setEditing(true)}><Pencil size={12} />Edit</button>}>
      {editing ? <EditGeneralPortalForm initial={portal} onCancel={() => setEditing(false)} onSave={save} /> : (
        <InfoGrid>
          <InfoRow label="Show Account Manager Details" value={portal['showAccountManagerDetails'] === false ? 'NO' : 'YES'} />
          <InfoRow label="Hide Total Click" value={portal['hideTotalClick'] ? 'YES' : 'NO'} />
          <InfoRow label="HTML Custom Header (Left menu)" value={String(portal['htmlCustomHeader'] ?? '')} />
          <InfoRow label="HTML Custom Footer (Left menu)" value={String(portal['htmlCustomFooter'] ?? '')} />
        </InfoGrid>
      )}
    </InfoCard>
  );
}

const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese'];

/** Matches the reference's own "Edit Partner Signup" General tab: single Yes/No pills for Use
 * External Sign Up URL / Customize Header / Customize Confirmation, the latter two revealing an
 * HTML textarea when Yes, plus a real Language select. */
function EditSignupFormForm({ initial, onCancel, onSave }: {
  initial: Record<string, unknown>; onCancel: () => void; onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [externalUrl, setExternalUrl] = useState(Boolean(initial['useExternalSignUpUrl']));
  const [customizeHeader, setCustomizeHeader] = useState(initial['customizeHeader'] !== false);
  const [customizeConfirmation, setCustomizeConfirmation] = useState(Boolean(initial['customizeConfirmation']));
  const [headerHtml, setHeaderHtml] = useState(String(initial['customSignUpHeader'] ?? ''));
  const [confirmHtml, setConfirmHtml] = useState(String(initial['customSignUpConfirmation'] ?? ''));
  const [language, setLanguage] = useState(String(initial['language'] ?? 'English'));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        useExternalSignUpUrl: externalUrl, customizeHeader, customizeConfirmation,
        customSignUpHeader: headerHtml, customSignUpConfirmation: confirmHtml, language,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-tiny text-fg-secondary"><Info size={13} className="text-fg-muted" /> Fields with an asterisk (*) are mandatory.</p>
      <div>
        <label className="label mb-2 block">Use External Sign Up URL</label>
        <YesNoToggle value={externalUrl} onChange={setExternalUrl} />
      </div>
      <div>
        <label className="label mb-2 block">Customize Header</label>
        <YesNoToggle value={customizeHeader} onChange={setCustomizeHeader} />
        {customizeHeader && (
          <div className="mt-3 max-w-lg rounded-card border border-border bg-page p-3">
            <label className="label mb-2 block">Custom Sign Up Header</label>
            <textarea rows={6} className="input w-full font-mono text-tiny" value={headerHtml} onChange={(e) => setHeaderHtml(e.target.value)} />
          </div>
        )}
      </div>
      <div>
        <label className="label mb-2 block">Customize Confirmation</label>
        <YesNoToggle value={customizeConfirmation} onChange={setCustomizeConfirmation} />
        {customizeConfirmation && (
          <div className="mt-3 max-w-lg rounded-card border border-border bg-page p-3">
            <label className="label mb-2 block">Custom Sign Up Confirmation</label>
            <textarea rows={6} className="input w-full font-mono text-tiny" value={confirmHtml} onChange={(e) => setConfirmHtml(e.target.value)} />
          </div>
        )}
      </div>
      <Field label="Language *">
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input !w-56">
          {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
        </select>
      </Field>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function SignupFormCard() {
  const { data: config, refetch } = useQuery<Record<string, unknown>>('/api/control-center/config/partners');
  const signup = (config?.signup as Record<string, unknown> | undefined) ?? {};
  const [editing, setEditing] = useState(false);
  const saveMut = useMutation((body: Record<string, unknown>) => cc.putConfig('partners', { signup: body }));
  const { data: fields, loading } = useQuery<Array<{ id: string; sortOrder: number; label: string; fieldType: string; required: boolean }>>('/api/custom-fields?entity=publisher');

  const save = async (body: Record<string, unknown>) => {
    const ok = await saveMut.run(body);
    if (ok) { setEditing(false); refetch(); }
    return !!ok;
  };

  const cfRows = (fields ?? []).map((f) => ({
    id: f.id,
    cells: {
      Order: String(f.sortOrder),
      Label: f.label,
      'Field Type': f.fieldType,
      Required: f.required ? 'Yes' : 'No',
    },
  }));

  return (
    <InfoCard title="Partner Sign Up Form Customization" action={editing ? <span /> : <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => setEditing(true)}><Pencil size={12} />Edit</button>}>
      {editing ? <EditSignupFormForm initial={signup} onCancel={() => setEditing(false)} onSave={save} /> : (
        <InfoGrid>
          <InfoRow label="Custom Sign Up Header" value={String(signup['customSignUpHeader'] ?? '')} />
          <InfoRow label="Custom Sign Up Confirmation" value={String(signup['customSignUpConfirmation'] ?? '')} />
          <InfoRow label="Auto Approve Partners" value={signup['autoApprovePartners'] ? 'YES' : 'NO'} />
          <InfoRow label="Language" value={String(signup['language'] ?? 'English')} />
        </InfoGrid>
      )}
      <p className="mb-2 mt-4 text-small font-semibold text-fg">Custom Fields Summary</p>
      <EmptyShellTable search={false} columns={['Order', 'Label', 'Field Type', 'Required']} rows={cfRows} loading={loading} />
    </InfoCard>
  );
}

/** Real card catalog from the reference's own Partner Dashboard — the names/descriptions are
 * product copy (safe to reproduce, same as every notification description elsewhere in this
 * session), but this app has no per-network dashboard-card visibility config, and several of these
 * cards describe data this app doesn't track at all (impressions, redirect traffic, on-hold
 * conversions) — so Visible renders honest "—", never a fabricated YES/NO. */
const DASHBOARD_CARDS: { card: string; desc: string }[] = [
  { card: 'Impressions', desc: 'Shows the total Impressions for all Offers the Partner is running.' },
  { card: 'Clicks', desc: "Shows the total clicks tracked through the Partner's Everflow Tracking Links." },
  { card: 'Conversions', desc: 'Shows the successful Base Conversions attributed to the Partner.' },
  { card: 'Events', desc: 'Shows additional actions tracked after the initial Base Conversion.' },
  { card: 'CVR', desc: 'Shows the percentage of Conversions per Clicks.' },
  { card: 'Redirect Traffic Revenue', desc: 'Shows an overview of revenue earned from redirected traffic.' },
  { card: 'Revenue', desc: 'Shows an overview of gross revenue reported to Everflow for the Partner.' },
  { card: 'EVR', desc: 'Shows the average number of Post-Conversion Events per unique Conversion.' },
  { card: 'Potential On Hold Revenue', desc: 'Shows the potential revenue from the on hold conversions.' },
  { card: 'On Hold Conversions', desc: 'Shows the total number of on hold conversions.' },
  { card: 'Performance', desc: 'Allows the Partner to evaluate the performance of two metrics over a designated time period.' },
  { card: 'Offers', desc: 'Provides an overview of all available Offers.' },
  { card: 'Custom Card', desc: 'A Dashboard card that you can customize with your own content.' },
  { card: 'Tracking & Asset Generator', desc: 'A tool to generate Tracking Links and associated assets for Offers.' },
];

function PartnerDashboardCard() {
  const { data: config, refetch } = useQuery<Record<string, unknown>>('/api/control-center/config/partners');
  const dashboard = (config?.dashboard as Record<string, unknown> | undefined) ?? {};
  const cardVis = (dashboard['cards'] as Record<string, boolean> | undefined) ?? {};
  const [editing, setEditing] = useState(false);
  const [vis, setVis] = useState<Record<string, boolean>>({});
  const saveMut = useMutation((body: Record<string, unknown>) => cc.putConfig('partners', { dashboard: body }));

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const c of DASHBOARD_CARDS) next[c.card] = cardVis[c.card] ?? false;
    setVis(next);
  }, [config]);

  const save = async () => {
    const ok = await saveMut.run({ cards: vis });
    if (ok) { setEditing(false); refetch(); }
  };

  return (
    <InfoCard title="Partner Dashboard Customization"
      action={editing ? <span /> : <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => setEditing(true)}><Pencil size={12} />Edit</button>}>
      <InfoBanner>Tailor your Partner Dashboard to reflect your brand. Click <strong>Edit</strong> to adjust the visibility, size, and order of the Dashboard cards.</InfoBanner>
      <HeadsUpBanner>Any changes made here will be updated across all Partner Dashboards</HeadsUpBanner>
      <p className="mb-2 mt-4 text-small font-semibold text-fg">Partner Dashboard Cards</p>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[520px] text-left text-body">
          <thead className="border-b border-border bg-page text-tiny uppercase tracking-wide text-fg-secondary">
            <tr className="divide-x divide-border">
              <th className="whitespace-nowrap px-4 py-3 font-semibold">Card</th>
              <th className="px-4 py-3 font-semibold">Description</th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">Visible</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {DASHBOARD_CARDS.map((c) => (
              <tr key={c.card}>
                <td className="whitespace-nowrap px-4 py-3 font-semibold text-fg">{c.card}</td>
                <td className="px-4 py-3 text-small text-fg-secondary">{c.desc}</td>
                <td className="px-4 py-3">
                  {editing
                    ? <YesNoToggle value={vis[c.card] ?? false} onChange={(v) => setVis((s) => ({ ...s, [c.card]: v }))} />
                    : <span className="text-small text-fg-secondary">{vis[c.card] ? 'YES' : '—'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)} disabled={saveMut.busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={saveMut.busy}>{saveMut.busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </InfoCard>
  );
}

function GeneralSub() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <GeneralPortalCard />
        <SignupFormCard />
      </div>
      <PartnerDashboardCard />
    </div>
  );
}

const OFFER_NOTIFS: NotifyDef[] = [
  { name: 'Offer Status Changed', desc: 'When the offer status changes', inApp: true, email: true },
  { name: 'Offer Changed Payout', desc: 'The payout of an offer on which you are active was modified', inApp: true, email: true },
  { name: 'Offer Description Changed', desc: 'When the html description of an offer is modified', inApp: true, email: false },
  { name: 'Creative Added to the Offer', desc: 'When a new creative is added to an offer', dropdown: true, inApp: true, email: true },
  { name: 'Traffic Optimized', desc: 'When a variable is blocked by the network', inApp: true, email: true },
  { name: 'New Base Conversion Registered', desc: 'When a new base conversion happens', email: false },
  { name: 'New Additional Event Registered', desc: 'When a new additional event happens', email: false },
  { name: 'Coupon Code Deactivated', desc: 'A coupon code is now inactive', dropdown: true, inApp: true, email: false },
  { name: 'On Hold Conversion Status Changed', desc: 'When an On Hold Conversion status changes', email: false },
];

function NotificationsSub() {
  const { data: config } = useQuery<Record<string, unknown>>('/api/control-center/config/partners');
  const saved = (config?.notifications as Record<string, unknown> | undefined) ?? {};
  const saveMut = useMutation(async () => {
    const res = await cc.putConfig('partners', { notifications: { ...saved, offers: saved['offers'] ?? {} } });
    return !!res;
  });

  return (
    <NotificationCard title="Offers" notifs={OFFER_NOTIFS} onSave={async () => !!(await saveMut.run(undefined))} />
  );
}

function ReferralSub() {
  const { data: config } = useQuery<Record<string, unknown>>('/api/control-center/config/partners');
  const referral = (config?.referral as Record<string, unknown> | undefined) ?? {};
  const { data, loading, refetch } = useQuery<Array<{
    id: string; ref?: number | null; enabled: boolean; commissionStructure: string;
    fixedAmountRate: string; minimumThreshold: string; duration: string;
    createdAt: string; updatedAt: string;
  }>>('/api/control-center/partner-referrals?status=all');

  const rows = (data ?? []).map((r) => ({
    id: r.id,
    cells: {
      ID: r.ref != null ? String(r.ref) : '—',
      Partner: '—',
      Enabled: r.enabled ? 'Yes' : 'No',
      'Commission Structure': r.commissionStructure || '—',
      'Fixed Amount / Rate': r.fixedAmountRate || '—',
      'Minimum Threshold': r.minimumThreshold || '—',
      Duration: r.duration || '—',
      Created: new Date(r.createdAt).toLocaleDateString(),
      Modified: new Date(r.updatedAt).toLocaleDateString(),
    },
  }));

  return (
    <div className="space-y-4">
      <InfoCard title="Global Setting">
        <InfoGrid>
          <InfoRow label="Enable Partner Referral" value={referral['enabled'] ? 'YES' : 'NO'} />
          <InfoRow label="Method" value={String(referral['method'] ?? '')} />
          <InfoRow label="Commission Type" value={String(referral['commissionType'] ?? '')} />
          <InfoRow label="Duration" value={String(referral['duration'] ?? '')} />
          <InfoRow label="Fixed Amount / Rate" value={String(referral['fixedAmountRate'] ?? '')} />
          <InfoRow label="Minimum Threshold" value={String(referral['minimumThreshold'] ?? '')} />
        </InfoGrid>
      </InfoCard>
      <EmptyShellTable
        columns={['ID', 'Partner', 'Enabled', 'Commission Structure', 'Fixed Amount / Rate', 'Minimum Threshold', 'Duration', 'Created', 'Modified']}
        rows={rows}
        loading={loading}
        onAddSubmit={async (v) => {
          await cc.create('partner-referrals', {
            enabled: v['Enabled']?.toLowerCase() !== 'no',
            commissionStructure: v['Commission Structure'] ?? '',
            fixedAmountRate: v['Fixed Amount / Rate'] ?? '',
            minimumThreshold: v['Minimum Threshold'] ?? '',
            duration: v['Duration'] ?? '',
          });
          refetch();
          return true;
        }}
        onDelete={async (id) => { await cc.del('partner-referrals', id); refetch(); }}
      />
    </div>
  );
}

function TermsSub() {
  const { data: config } = useQuery<Record<string, unknown>>('/api/control-center/config/partners');
  const terms = (config?.terms as Record<string, unknown> | undefined) ?? {};
  const { data, loading } = useQuery<Array<{
    id: string; partnerUser: string; userAgent: string | null; ipAddress: string | null; createdAt: string;
  }>>('/api/control-center/terms-acceptances');

  const rows = (data ?? []).map((r) => ({
    id: r.id,
    cells: {
      Created: new Date(r.createdAt).toLocaleString(),
      Partner: '—',
      'Partner User': r.partnerUser || '—',
      'User Agent': r.userAgent ?? '—',
      'IP Address': r.ipAddress ?? '—',
    },
  }));

  return (
    <div className="space-y-4">
      <InfoCard title="Terms and Conditions">
        <InfoGrid>
          <InfoRow label="Enforce Terms and Conditions" value={terms['enforce'] ? 'YES' : 'NO'} />
          <InfoRow label="Terms and Conditions" value={String(terms['content'] ?? '')} />
        </InfoGrid>
      </InfoCard>
      <EmptyShellTable
        columns={['Created', 'Partner', 'Partner User', 'User Agent', 'IP Address']}
        rows={rows}
        loading={loading}
      />
    </div>
  );
}

export default function PartnersTab() {
  const [sub, setSub] = useState<string>('General');
  return (
    <>
      <Tabs tabs={[...SUB_TABS]} active={sub} onChange={setSub} />
      {sub === 'General' && <GeneralSub />}
      {sub === 'Default Notifications' && <NotificationsSub />}
      {sub === 'Partner Referral' && <ReferralSub />}
      {sub === 'Terms & Conditions' && <TermsSub />}
    </>
  );
}
