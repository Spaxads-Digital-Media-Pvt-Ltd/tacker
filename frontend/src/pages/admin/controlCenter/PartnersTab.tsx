/**
 * Control Center › Partners — network-wide partner-facing config (sign-up form, dashboard cards,
 * referral program, terms & conditions). No backend concept exists for any of this, so it's an
 * honest static/shell replica of the reference's structure.
 */
import { useState } from 'react';
import { Pencil, Info } from 'lucide-react';
import { Tabs, Field } from '../../../components/ui';
import { EmptyShellTable } from '../../../components/EmptyShellTable';
import { InfoCard, InfoGrid, InfoRow, NotificationRow, InfoBanner, HeadsUpBanner, Toggle, YesNoToggle, HelpIcon, type NotifyDef } from './shared';

const SUB_TABS = ['General', 'Default Notifications', 'Partner Referral', 'Terms & Conditions'] as const;

/** Matches the reference's own "Edit Partner Portal" form: a plain checkbox for Hide Total Click, a
 * single Yes/No pill for Show Account Manager Details that reveals a nested sub-toggle when Yes, and
 * two HTML textareas each with an (inert — no macro engine in this app) "Add Macro" button. */
function EditGeneralPortalForm({ onCancel }: { onCancel: () => void }) {
  const [hideTotalClick, setHideTotalClick] = useState(false);
  const [showAcctMgr, setShowAcctMgr] = useState(true);
  const [showAcctMgrCustom, setShowAcctMgrCustom] = useState(false);
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
        <textarea rows={4} className="input w-full" />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="label flex items-center gap-1.5">HTML Custom Footer (Left menu) <HelpIcon text="Rendered in the left navigation footer across the Partner portal." /></label>
          <button title="Not available yet" className="flex items-center gap-1 rounded-[var(--radius)] border border-border px-2 py-1 text-tiny font-medium text-fg-secondary hover:bg-page">{'{ }'} Add Macro</button>
        </div>
        <textarea rows={4} className="input w-full" />
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={onCancel}>Save</button>
      </div>
    </div>
  );
}

function GeneralPortalCard() {
  const [editing, setEditing] = useState(false);
  return (
    <InfoCard title="General" action={editing ? <span /> : <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => setEditing(true)}><Pencil size={12} />Edit</button>}>
      {editing ? <EditGeneralPortalForm onCancel={() => setEditing(false)} /> : (
        <InfoGrid>
          <InfoRow label="Show Account Manager Details" />
          <InfoRow label="Hide Total Click" />
          <InfoRow label="HTML Custom Header (Left menu)" />
          <InfoRow label="HTML Custom Footer (Left menu)" />
        </InfoGrid>
      )}
    </InfoCard>
  );
}

const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese'];

/** Matches the reference's own "Edit Partner Signup" General tab: single Yes/No pills for Use
 * External Sign Up URL / Customize Header / Customize Confirmation, the latter two revealing an
 * HTML textarea when Yes, plus a real Language select. */
function EditSignupFormForm({ onCancel }: { onCancel: () => void }) {
  const [externalUrl, setExternalUrl] = useState(false);
  const [customizeHeader, setCustomizeHeader] = useState(true);
  const [customizeConfirmation, setCustomizeConfirmation] = useState(false);
  const [language, setLanguage] = useState('English');
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
            <textarea rows={6} className="input w-full font-mono text-tiny" />
          </div>
        )}
      </div>
      <div>
        <label className="label mb-2 block">Customize Confirmation</label>
        <YesNoToggle value={customizeConfirmation} onChange={setCustomizeConfirmation} />
        {customizeConfirmation && (
          <div className="mt-3 max-w-lg rounded-card border border-border bg-page p-3">
            <label className="label mb-2 block">Custom Sign Up Confirmation</label>
            <textarea rows={6} className="input w-full font-mono text-tiny" />
          </div>
        )}
      </div>
      <Field label="Language *">
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input !w-56">
          {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
        </select>
      </Field>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={onCancel}>Save</button>
      </div>
    </div>
  );
}

function SignupFormCard() {
  const [editing, setEditing] = useState(false);
  return (
    <InfoCard title="Partner Sign Up Form Customization" action={editing ? <span /> : <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => setEditing(true)}><Pencil size={12} />Edit</button>}>
      {editing ? <EditSignupFormForm onCancel={() => setEditing(false)} /> : (
        <InfoGrid>
          <InfoRow label="Custom Sign Up Header" />
          <InfoRow label="Custom Sign Up Confirmation" />
          <InfoRow label="Auto Approve Partners" />
          <InfoRow label="Language" value="English" />
        </InfoGrid>
      )}
      <p className="mb-2 mt-4 text-small font-semibold text-fg">Custom Fields Summary</p>
      <EmptyShellTable search={false} columns={['Order', 'Label', 'Field Type', 'Required']} />
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
  const [editing, setEditing] = useState(false);
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
                <td className="px-4 py-3">{editing ? <Toggle on={false} /> : <span className="text-small text-fg-secondary">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => setEditing(false)}>Save</button>
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
  return (
    <InfoCard title="Offers" action={<span />}>
      <div>{OFFER_NOTIFS.map((n) => <NotificationRow key={n.name} n={n} />)}</div>
    </InfoCard>
  );
}

function ReferralSub() {
  return (
    <div className="space-y-4">
      <InfoCard title="Global Setting">
        <InfoGrid>
          <InfoRow label="Enable Partner Referral" />
          <InfoRow label="Method" />
          <InfoRow label="Commission Type" />
          <InfoRow label="Duration" />
          <InfoRow label="Fixed Amount / Rate" />
          <InfoRow label="Minimum Threshold" />
        </InfoGrid>
      </InfoCard>
      <EmptyShellTable columns={['ID', 'Partner', 'Enabled', 'Commission Structure', 'Fixed Amount / Rate', 'Minimum Threshold', 'Duration', 'Created', 'Modified']} />
    </div>
  );
}

function TermsSub() {
  return (
    <div className="space-y-4">
      <InfoCard title="Terms and Conditions">
        <InfoGrid>
          <InfoRow label="Enforce Terms and Conditions" />
          <InfoRow label="Terms and Conditions" />
        </InfoGrid>
      </InfoCard>
      <EmptyShellTable columns={['Created', 'Partner', 'Partner User', 'User Agent', 'IP Address']} />
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
