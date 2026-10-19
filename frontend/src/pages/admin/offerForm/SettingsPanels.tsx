/**
 * Attribution, Revenue & Payout (Events) and Email settings for Offer Create / Edit. All values are
 * saved on the offer. Where a setting depends on an external account (IPQualityScore, Optizmo), the
 * panel shows whether that integration is actually connected in Integrations.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Field, Segmented } from '../../../shared-components/primitives/ui';
import { useQuery } from '../../../lib/useApi';
import type { DuplicateMode, OfferAttributionSettings, OfferEmailSettings, OfferRevenueSettings } from '../../../types';
import { YesNoToggle } from './controls';
import { DUPLICATE_MODE_OPTIONS } from './settings';

interface CatalogCard { id: string; connected: boolean }
type Catalog = Record<string, { connected: CatalogCard[]; notConnected: CatalogCard[] }>;

/** Integration ids connected for this network (from Integrations' own catalog). */
function useConnectedIntegrations(): Set<string> {
  const { data } = useQuery<Catalog>('/api/settings/integrations/catalog');
  const ids = new Set<string>();
  for (const cat of Object.values(data ?? {})) for (const c of cat?.connected ?? []) ids.add(c.id);
  return ids;
}

function IntegrationStatus({ connected, name }: { connected: boolean; name: string }) {
  return connected ? (
    <p className="mt-1 text-tiny text-success-text">{name} is connected.</p>
  ) : (
    <p className="mt-1 text-tiny text-warning-text">
      No {name} API key yet — the setting is saved and takes effect once you connect it in <Link to="/app/integrations" className="underline">Integrations</Link>.
    </p>
  );
}

const Note = ({ children }: { children: ReactNode }) => <p className="mt-1 text-tiny text-fg-muted">{children}</p>;

const DURATIONS: [string, number | null][] = [
  ['1 Hour', 3600], ['6 Hours', 21600], ['12 Hours', 43200], ['24 Hours', 86400], ['7 Days', 604800], ['30 Days', 2592000], ['No maximum', null],
];

export function AttributionSettingsPanel({ value, onChange }: { value: OfferAttributionSettings; onChange: (v: OfferAttributionSettings) => void }) {
  const connected = useConnectedIntegrations();
  const set = <K extends keyof OfferAttributionSettings>(k: K, v: OfferAttributionSettings[K]) => onChange({ ...value, [k]: v });
  const c = value.clickToConversion;
  return (
    <div className="space-y-5">
      <div>
        <label className="label mb-2 block">24metrics Tracker</label>
        <div className="flex flex-wrap items-center gap-2">
          <YesNoToggle on={value.tracker24.enabled} onChange={(on) => set('tracker24', { ...value.tracker24, enabled: on })} />
          {value.tracker24.enabled && (
            <input className="input !w-64" placeholder="24metrics tracker ID" value={value.tracker24.trackerId ?? ''}
              onChange={(e) => set('tracker24', { ...value.tracker24, trackerId: e.target.value || null })} />
          )}
        </div>
        <Note>Every click is checked by 24metrics in the background (the redirect never waits). A click it rejects is marked invalid, its conversions wait in Pending for review, and the address is blocked for a day; approved conversions are reported back to 24metrics. The tracker ID is the integration ID 24metrics gives you.</Note>
      </div>

      <div>
        <label className="label mb-2 block">Enable IPQualityScore Fraud Detection</label>
        <YesNoToggle on={value.ipqs.enabled} onChange={(on) => set('ipqs', { enabled: on })} />
        {value.ipqs.enabled ? <IntegrationStatus connected={connected.has('ip-quality')} name="IPQualityScore" />
          : <Note>When on, each click’s IP is scored by IPQualityScore in the background (never slows the redirect) and proxy/VPN/Tor/bot flags are added to the click.</Note>}
      </div>

      <div>
        <label className="label mb-2 block">Apply Throttle Rate</label>
        <div className="flex flex-wrap items-center gap-2">
          <YesNoToggle on={value.throttle.enabled} onChange={(on) => set('throttle', { ...value.throttle, enabled: on })} />
          {value.throttle.enabled && (
            <div className="flex items-center gap-1.5">
              <input type="number" min={0} max={100} step="0.1" className="input !w-28" value={value.throttle.ratePct}
                onChange={(e) => set('throttle', { ...value.throttle, ratePct: Number(e.target.value) })} />
              <span className="text-small text-fg-secondary">%</span>
            </div>
          )}
        </div>
        <Note>This share of approved conversions still bills the advertiser but pays the partner nothing and fires no partner postback.</Note>
      </div>

      <div>
        <label className="label mb-2 block">Enable Click to Conversion Time</label>
        <YesNoToggle on={c.enabled} onChange={(on) => set('clickToConversion', { ...c, enabled: on })} />
        {c.enabled && (
          <div className="mt-3 grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-2">
            <Field label="Minimum Lookback Window (seconds)">
              <input type="number" min={0} className="input" value={c.minSeconds}
                onChange={(e) => set('clickToConversion', { ...c, minSeconds: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
            </Field>
            <Field label="Max. Approved Click to Conversion Time">
              <select className="input" value={c.maxSeconds == null ? '' : String(c.maxSeconds)}
                onChange={(e) => set('clickToConversion', { ...c, maxSeconds: e.target.value ? Number(e.target.value) : null })}>
                {DURATIONS.map(([label, s]) => <option key={label} value={s == null ? '' : String(s)}>{label}</option>)}
              </select>
            </Field>
          </div>
        )}
        <Note>Conversions that arrive faster than the minimum or later than the maximum after the click are rejected.</Note>
      </div>

      <div>
        <label className="label mb-2 block">Enable Server-Side Click</label>
        <YesNoToggle on={value.serverSideClick} onChange={(on) => set('serverSideClick', on)} />
        <Note>When on, a server can call the tracking link with <code className="font-mono">&amp;format=json</code> and receive <code className="font-mono">{'{ click_id, redirect_url }'}</code> instead of a redirect.</Note>
      </div>

      <div>
        <label className="label mb-2 block">Enable Email Ownership</label>
        <YesNoToggle on={value.emailOwnership} onChange={(on) => set('emailOwnership', on)} />
        {value.emailOwnership && (
          <div className="mt-3 grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-3">
            <Field label="Owner">
              <select className="input" value={value.emailOwnershipMethod ?? 'first'} onChange={(e) => set('emailOwnershipMethod', e.target.value as 'first' | 'last')}>
                <option value="first">First partner keeps the customer</option>
                <option value="last">Latest converting partner</option>
              </select>
            </Field>
            <Field label="Ownership Window (days)">
              <input type="number" min={1} className="input" placeholder="No limit" value={value.emailOwnershipWindowDays ?? ''}
                onChange={(e) => set('emailOwnershipWindowDays', e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
            </Field>
            <Field label="Window Counts From">
              <select className="input" value={value.emailOwnershipWindowMode ?? 'static'} onChange={(e) => set('emailOwnershipWindowMode', e.target.value as 'static' | 'dynamic')}>
                <option value="static">When ownership began</option>
                <option value="dynamic">The latest conversion</option>
              </select>
            </Field>
          </div>
        )}
        <Note>A conversion that sends the customer’s email (<code className="font-mono">email=</code>, or <code className="font-mono">email_sha256=</code>) makes its partner the customer’s owner on this offer. A later postback with the email and <code className="font-mono">offer_id</code> but no click id — a rebill, a repeat order — is credited to the owner. Only a hash of the address is stored.</Note>
      </div>

      <div>
        <label className="label mb-2 block">Enable View-Through</label>
        <YesNoToggle on={value.viewThrough} onChange={(on) => set('viewThrough', on)} />
        {value.viewThrough && (
          <div className="mt-3 grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-2">
            <Field label="View-Through Window (hours)">
              <input type="number" min={1} max={720} className="input" value={value.viewThroughWindowHours ?? 24}
                onChange={(e) => set('viewThroughWindowHours', Math.min(720, Math.max(1, Math.floor(Number(e.target.value) || 1))))} />
            </Field>
          </div>
        )}
        <Note>A conversion with no click is credited to the partner whose ad the visitor saw (the impression pixel) within the window — matched by <code className="font-mono">impression_id</code> on the postback, the impression cookie on the pixel, or the visitor’s IP with <code className="font-mono">offer_id</code>. A click always wins.</Note>
      </div>
    </div>
  );
}

export function RevenueSettingsPanel({ value, onChange, firePartnerPostback, onFirePartnerPostbackChange, revenue, onRevenueChange }: {
  value: OfferRevenueSettings; onChange: (v: OfferRevenueSettings) => void;
  firePartnerPostback: boolean; onFirePartnerPostbackChange: (v: boolean) => void;
  revenue: string; onRevenueChange: (v: string) => void;
}) {
  const set = <K extends keyof OfferRevenueSettings>(k: K, v: OfferRevenueSettings[K]) => onChange({ ...value, [k]: v });
  const pct = value.revenueType !== 'fixed';
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-h3 font-medium text-fg">Base Conversion Event</h3>
        <Field label="Base Conversion Event Name" hint="Recorded as the event name when the advertiser's postback doesn't send one.">
          <input className="input" placeholder="Base" value={value.baseEventName ?? ''} onChange={(e) => set('baseEventName', e.target.value || null)} />
        </Field>
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-small text-fg">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={firePartnerPostback} onChange={(e) => onFirePartnerPostbackChange(e.target.checked)} />
            <span><strong>Fire Partner Postback</strong> — fire Partner Postbacks when a conversion is approved.</span>
          </label>
          <label className="flex items-start gap-2 text-small text-fg">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border" checked={value.manualApproval} onChange={(e) => set('manualApproval', e.target.checked)} />
            <span><strong>Manually Approve Conversions</strong> — conversions that would auto-approve are held as Pending (no payout, no partner postback) until approved in Reporting › Conversion.</span>
          </label>
        </div>
        <Field label="Duplicate Conversions" hint="Upsells, renewals and rev-share sales can bring several conversions from one click. A transaction ID repeated for the same event is always a duplicate, and an identical postback repeated within 60 seconds counts once. An event can override this on the Goals tab.">
          <select className="input" value={value.duplicateMode}
            onChange={(e) => { const mode = e.target.value as DuplicateMode; onChange({ ...value, duplicateMode: mode, allowDuplicates: mode !== 'one_per_click' }); }}>
            {DUPLICATE_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Hold Unusual Volume" hint="When one click sends more conversions than this within 10 minutes, the next ones are held as Pending for review — recorded, never dropped. 0 = no limit.">
          <div className="flex items-center gap-1.5">
            <input type="number" min={0} step={1} className="input !w-32" value={value.clickConversionLimit ?? 0}
              onChange={(e) => set('clickConversionLimit', e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value))))} />
            <span className="text-small text-fg-secondary">conversions from one click in 10 minutes</span>
          </div>
        </Field>
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <h3 className="text-h3 font-medium text-fg">Base Revenue</h3>
        <div>
          <label className="label mb-2 block">Revenue Action *</label>
          <Segmented options={[{ value: 'impression', label: 'Impression' }, { value: 'click', label: 'Click' }, { value: 'conversion', label: 'Base Conversion Event' }]}
            value={value.revenueAction} onChange={(v) => set('revenueAction', v as OfferRevenueSettings['revenueAction'])} />
          {value.revenueAction !== 'conversion' && (
            <Note>
              {value.revenueAction === 'click'
                ? 'The advertiser is billed this amount for each unique, valid click from a partner (booked as a paid click).'
                : 'The advertiser is billed this amount per 1,000 valid impressions from a partner (booked every few minutes).'}
              {' '}Conversions then carry no base revenue; event goals still bill their own.
            </Note>
          )}
        </div>
        <div className="space-y-3 rounded-card border border-border bg-page p-4">
          <label className="label mb-1 block">Revenue Type *</label>
          <Segmented options={[{ value: 'fixed', label: 'Fixed Revenue' }, { value: 'percentage', label: 'Percentage Revenue' }, { value: 'mixed', label: 'Mixed Revenue' }]}
            value={value.revenueType} onChange={(v) => set('revenueType', v as OfferRevenueSettings['revenueType'])} />
          {value.revenueType !== 'percentage' && (
            <Field label={value.revenueAction === 'click' ? 'Revenue Per Click *' : value.revenueAction === 'impression' ? 'Revenue Per 1,000 Impressions *'
              : value.revenueType === 'mixed' ? 'Fixed Revenue Per Action *' : 'Revenue Per Action (RPA) *'}>
              <input className="input" inputMode="decimal" value={revenue} onChange={(e) => onRevenueChange(e.target.value)} />
            </Field>
          )}
          {pct && (
            <Field label="Revenue Percentage *" hint="Share of the sale amount the advertiser reports as sale_amount (or order_amount) on the postback.">
              <div className="flex items-center gap-1.5">
                <input type="number" min={0} max={100} step="0.01" className="input !w-32" value={value.revenuePct ?? ''}
                  onChange={(e) => set('revenuePct', e.target.value === '' ? null : Number(e.target.value))} />
                <span className="text-small text-fg-secondary">% of sale amount</span>
              </div>
            </Field>
          )}
          <label className="flex items-start gap-2 text-small text-fg">
            <input type="checkbox" checked={value.pricePerProduct} onChange={(e) => set('pricePerProduct', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border" />
            <span><strong>Price Per Product</strong> — the postback’s products (<code className="font-mono">products=[…]</code>, or <code className="font-mono">sku=&amp;quantity=&amp;price=</code>) are priced line by line: by the offer’s product rule for the SKU or category (<code className="font-mono">/api/offers/:id/products</code>), else the base rate per unit.</span>
          </label>
        </div>
      </div>
    </div>
  );
}

export function EmailSettingsPanel({ value, onChange }: { value: OfferEmailSettings; onChange: (v: OfferEmailSettings) => void }) {
  const connected = useConnectedIntegrations();
  const set = <K extends keyof OfferEmailSettings>(k: K, v: OfferEmailSettings[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <label className="label mb-2 block">Enable Suppression File</label>
        <YesNoToggle on={value.suppression.enabled} onChange={(on) => set('suppression', { ...value.suppression, enabled: on })} />
        {value.suppression.enabled && (
          <input className="input mt-2" placeholder="https://… (link to the suppression list partners must scrub against)" value={value.suppression.fileUrl ?? ''}
            onChange={(e) => set('suppression', { ...value.suppression, fileUrl: e.target.value || null })} />
        )}
      </div>
      <div>
        <label className="label mb-2 block">Ezepo Enabled</label>
        <YesNoToggle on={value.ezepo.enabled} onChange={(on) => set('ezepo', { enabled: on })} />
        <Note>Saved on the offer. There’s no Ezepo integration in this app, so nothing is synced to Ezepo.</Note>
      </div>
      <div>
        <label className="label mb-2 block">Optizmo Suppression List</label>
        <div className="flex flex-wrap items-center gap-2">
          <YesNoToggle on={value.optizmo.enabled} onChange={(on) => set('optizmo', { ...value.optizmo, enabled: on })} />
          {value.optizmo.enabled && (
            <input className="input !w-64" placeholder="Optizmo list / access key ID" value={value.optizmo.listId ?? ''}
              onChange={(e) => set('optizmo', { ...value.optizmo, listId: e.target.value || null })} />
          )}
        </div>
        {value.optizmo.enabled && <IntegrationStatus connected={connected.has('optizmo')} name="Optizmo" />}
      </div>
      <div>
        <label className="label mb-2 block">Enable Email Instructions</label>
        <YesNoToggle on={value.instructions.enabled} onChange={(on) => set('instructions', { ...value.instructions, enabled: on })} />
        {value.instructions.enabled && (
          <textarea className="input mt-2 min-h-[100px]" placeholder="Approved from lines, subject lines, mailing rules…" value={value.instructions.text ?? ''}
            onChange={(e) => set('instructions', { ...value.instructions, text: e.target.value || null })} />
        )}
      </div>
      <div>
        <label className="label mb-2 block">Enable Email Opt-out</label>
        <YesNoToggle on={value.optOut.enabled} onChange={(on) => set('optOut', { ...value.optOut, enabled: on })} />
        {value.optOut.enabled && (
          <input className="input mt-2" placeholder="https://… (unsubscribe / opt-out link)" value={value.optOut.url ?? ''}
            onChange={(e) => set('optOut', { ...value.optOut, url: e.target.value || null })} />
        )}
      </div>
    </div>
  );
}
