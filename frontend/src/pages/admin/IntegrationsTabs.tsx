/**
 * Everflow-style Integrations tabs — Connected / Not connected sections, each card backend-wired.
 */
import { useState, useEffect, useMemo, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { Field, Modal, StateBlock, Spinner } from '../../shared-components/primitives/ui';
import { Accordion } from '../../shared-components/panels/Accordion';

// ── Types ──────────────────────────────────────────────────────────────────

interface CatalogCard {
  id: string;
  name: string;
  tagline: string;
  description: string;
  connected: boolean;
  detail: string;
  badge?: 'upgrade' | 'native';
  settingsKey?: string;
}

interface CategoryCatalog {
  connected: CatalogCard[];
  notConnected: CatalogCard[];
}

type ConfigureType = 'api-key' | 'fraud-rules' | 'smtp' | 'link' | 'facebook' | 'pin' | 'agreement' | 'shopify';

const CONFIGURE: Record<string, { type: ConfigureType; link?: string; settingsKey?: string; label?: string }> = {
  'network-fraud': { type: 'fraud-rules' },
  'ip-quality': { type: 'api-key', settingsKey: 'ipQualityScoreApiKey', label: 'API Key' },
  anura: { type: 'api-key', settingsKey: 'anuraApiKey', label: 'API Key' },
  'traffic-controls': { type: 'link', link: '/app/offers-traffic-controls' },
  optizmo: { type: 'api-key', settingsKey: 'optizmoApiKey', label: 'API Key' },
  'partner-blocking': { type: 'link', link: '/app/aff-traffic-blocking' },
  'partner-invoices': { type: 'link', link: '/app/aff-invoices' },
  'advertiser-invoices': { type: 'link', link: '/app/adv-invoices' },
  tipalti: { type: 'api-key', settingsKey: 'tipaltiApiKey', label: 'API Key' },
  'facebook-capi': { type: 'facebook' },
  'pin-api': { type: 'pin' },
  'google-ads': { type: 'api-key', settingsKey: 'googleAdsApiKey', label: 'API Key' },
  'communication-hub': { type: 'link', link: '/app/communication-hub' },
  salesforce: { type: 'api-key', settingsKey: 'salesforceApiKey', label: 'API Key' },
  hubspot: { type: 'api-key', settingsKey: 'hubspotApiKey', label: 'API Key' },
  shopify: { type: 'shopify' },
  woocommerce: { type: 'api-key', settingsKey: 'woocommerceStoreUrl', label: 'Store URL' },
  stripe: { type: 'api-key', settingsKey: 'stripeApiKey', label: 'API Key' },
  'coupon-codes': { type: 'link', link: '/app/aff-coupons' },
  invoca: { type: 'api-key', settingsKey: 'invocaApiKey', label: 'API Key' },
  ringba: { type: 'api-key', settingsKey: 'ringbaApiKey', label: 'API Key' },
  'offline-calls': { type: 'link', link: '/app/reports/conversion-imports' },
  smtp: { type: 'smtp' },
  sendgrid: { type: 'api-key', settingsKey: 'sendgridApiKey', label: 'API Key' },
  mailchimp: { type: 'api-key', settingsKey: 'mailchimpApiKey', label: 'API Key' },
  's2s-postback': { type: 'link', link: '/app/adv-debug-postback' },
  appsflyer: { type: 'api-key', settingsKey: 'appsflyerApiKey', label: 'API Token' },
  adjust: { type: 'api-key', settingsKey: 'adjustApiKey', label: 'API Token' },
  branch: { type: 'api-key', settingsKey: 'branchApiKey', label: 'API Key' },
  docusign: { type: 'api-key', settingsKey: 'docusignApiKey', label: 'Integration Key' },
  hellosign: { type: 'api-key', settingsKey: 'hellosignApiKey', label: 'API Key' },
  'partner-agreement': { type: 'agreement' },
};

// ── Everflow-style card row ────────────────────────────────────────────────

function EverflowCard({ card, onConfigure }: { card: CatalogCard; onConfigure: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-4 last:border-0">
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius)] border border-border bg-page text-h3 font-bold text-accent-text">
        {card.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-fg">{card.name}</p>
          {card.connected && (
            <span className="inline-flex h-2 w-2 rounded-full bg-success" title="Connected" />
          )}
          {card.connected && card.badge === 'upgrade' && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-tiny font-semibold uppercase tracking-wide text-warning">Upgrade Available</span>
          )}
          {card.badge === 'native' && card.connected && (
            <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-tiny font-medium text-accent-text">Native</span>
          )}
        </div>
        <p className="mt-0.5 text-small font-semibold text-fg-secondary">{card.tagline}</p>
        <p className="mt-1 text-small leading-relaxed text-fg-muted">{card.description}</p>
      </div>
      <div className="shrink-0 pt-1">
        <button type="button" className={card.connected ? 'btn-ghost' : 'btn-primary'} onClick={onConfigure}>
          {card.connected ? 'Configure' : 'Connect Integration'}
        </button>
      </div>
    </div>
  );
}

function CardList({ cards, onConfigure }: { cards: CatalogCard[]; onConfigure: (id: string) => void }) {
  if (cards.length === 0) {
    return <p className="py-6 text-center text-small italic text-fg-muted">No integrations in this section.</p>;
  }
  return <>{cards.map((c) => <EverflowCard key={c.id} card={c} onConfigure={() => onConfigure(c.id)} />)}</>;
}

// ── Configure modals ─────────────────────────────────────────────────────────

interface FraudConfig {
  enabled: boolean; velocityPerMinute: number; datacenterRatioThreshold: number; botRatioThreshold: number; proxyRatioThreshold: number;
  minClickToConversionSeconds: number; crSpikeThreshold: number; minClicksForCrAlert: number; scanWindowHours: number;
  /** F-23: clicks scoring at least this are diverted at /click (null = flag only). */
  blockScore: number | null;
  /** Points each signal adds to a click's fraud score (0–100). */
  weights: Record<WeightKey, number>;
  alertEmails: string[];
  /** Masked on read (origin + "/…"); sending the masked value back keeps the stored URL. */
  alertWebhookUrl: string | null;
  alertWebhookUrlSet: boolean;
}

type WeightKey = 'datacenter' | 'velocity' | 'botUserAgent' | 'ipqsProxy' | 'ipqsVpn' | 'ipqsTor' | 'ipqsBot';
const WEIGHT_LABELS: [WeightKey, string][] = [
  ['datacenter', 'Datacenter / hosting IP'], ['velocity', 'Too many clicks per minute'], ['botUserAgent', 'Bot, headless or no user agent'],
  ['ipqsProxy', 'IPQS: proxy'], ['ipqsVpn', 'IPQS: VPN'], ['ipqsTor', 'IPQS: Tor'], ['ipqsBot', 'IPQS: bot'],
];

/** The extra (F-23) fraud settings, edited as text and turned into the PUT body on save. */
interface FraudExtras { blockScore: string; weights: Record<WeightKey, string>; alertEmails: string; webhook: string }

function fraudExtrasFrom(rules: FraudConfig | null | undefined): FraudExtras {
  const w = rules?.weights;
  return {
    blockScore: rules?.blockScore != null ? String(rules.blockScore) : '',
    weights: Object.fromEntries(WEIGHT_LABELS.map(([k]) => [k, w?.[k] != null ? String(w[k]) : ''])) as Record<WeightKey, string>,
    alertEmails: (rules?.alertEmails ?? []).join('\n'),
    webhook: rules?.alertWebhookUrl ?? '',
  };
}

interface SmtpSettings {
  host?: string; port?: number; username?: string; fromEmail?: string; fromName?: string; secure?: boolean; passwordSet?: boolean;
}

function ConfigureModals({
  active, onClose, onSaved,
}: {
  active: { type: ConfigureType; cardId: string; settingsKey?: string; label?: string; link?: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: settings, refetch: refetchSettings } = useQuery<{ integrations: Record<string, unknown>; smtp: SmtpSettings }>('/api/settings');
  const { data: rules, refetch: refetchRules } = useQuery<FraudConfig>('/api/fraud-rules');
  const [apiKey, setApiKey] = useState('');
  const [shopifyUrl, setShopifyUrl] = useState('');
  const [agreementName, setAgreementName] = useState('');
  const [agreementUrl, setAgreementUrl] = useState('');
  const [fbForm, setFbForm] = useState({ fbPixelId: '', fbAccessToken: '' });
  const [pinKey, setPinKey] = useState('');
  const [fraudForm, setFraudForm] = useState<Partial<FraudConfig>>({});
  const [fraudExtras, setFraudExtras] = useState<FraudExtras>(() => fraudExtrasFrom(null));
  const [smtpForm, setSmtpForm] = useState<SmtpSettings & { password?: string }>({});

  const putIntegrations = useMutation((values: Record<string, unknown>) => api.put('/api/settings/integrations', { values }));
  const putSmtp = useMutation((body: SmtpSettings & { password?: string }) => api.put('/api/settings/smtp', body));
  const putFraud = useMutation((body: Partial<FraudConfig>) => api.put('/api/fraud-rules', body));

  // Memoised: a fresh {} each render would re-run the reset effect below on every keystroke.
  const cur = useMemo(() => settings?.integrations ?? {}, [settings]);
  const smtp = useMemo<SmtpSettings>(() => settings?.smtp ?? {}, [settings]);
  // Credentials never come back from GET /api/settings — only `<key>Set` (true when one is stored).
  const isSet = (key: string) => Boolean(cur[`${key}Set`]);

  useEffect(() => {
    if (!active) return;
    setApiKey('');
    setPinKey('');
    setShopifyUrl((cur['shopifyStoreUrl'] as string) ?? '');
    setAgreementName((cur['esignAgreementName'] as string) ?? '');
    setAgreementUrl((cur['esignAgreementUrl'] as string) ?? '');
    setFbForm({ fbPixelId: (cur['fbPixelId'] as string) ?? '', fbAccessToken: '' });
    setFraudForm(rules ?? {});
    setFraudExtras(fraudExtrasFrom(rules));
    setSmtpForm({ host: smtp.host ?? '', port: smtp.port ?? 587, username: smtp.username ?? '', fromEmail: smtp.fromEmail ?? '', fromName: smtp.fromName ?? '', secure: smtp.secure ?? false });
  }, [active, cur, rules, smtp]);

  if (!active) return null;

  const title = active.cardId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const saveApiKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!active.settingsKey || !apiKey) return;
    if (await putIntegrations.run({ [active.settingsKey]: apiKey })) { onSaved(); onClose(); }
  };

  const saveShopify = async (e: FormEvent) => {
    e.preventDefault();
    const values: Record<string, unknown> = { shopifyStoreUrl: shopifyUrl, shopifyApiEnabled: true };
    if (apiKey) values['shopifyApiKey'] = apiKey;
    if (await putIntegrations.run(values)) { onSaved(); onClose(); }
  };

  const saveAgreement = async (e: FormEvent) => {
    e.preventDefault();
    if (await putIntegrations.run({ esignAgreementName: agreementName, esignAgreementUrl: agreementUrl })) { onSaved(); onClose(); }
  };

  const saveFb = async (e: FormEvent) => {
    e.preventDefault();
    const values: Record<string, unknown> = {};
    if (fbForm.fbPixelId) values['fbPixelId'] = fbForm.fbPixelId;
    if (fbForm.fbAccessToken) values['fbAccessToken'] = fbForm.fbAccessToken;
    if (await putIntegrations.run(values)) { onSaved(); onClose(); }
  };

  const savePin = async (e: FormEvent) => {
    e.preventDefault();
    if (!pinKey) return;
    if (await putIntegrations.run({ pinApiKey: pinKey })) { onSaved(); onClose(); }
  };

  const saveFraud = async (e: FormEvent) => {
    e.preventDefault();
    const pick = (k: keyof FraudConfig) => fraudForm[k] ?? rules?.[k];
    const body: Record<string, unknown> = {
      enabled: pick('enabled'), velocityPerMinute: pick('velocityPerMinute'), datacenterRatioThreshold: pick('datacenterRatioThreshold'),
      botRatioThreshold: pick('botRatioThreshold'), proxyRatioThreshold: pick('proxyRatioThreshold'),
      minClickToConversionSeconds: pick('minClickToConversionSeconds'), crSpikeThreshold: pick('crSpikeThreshold'),
      minClicksForCrAlert: pick('minClicksForCrAlert'), scanWindowHours: pick('scanWindowHours'),
      blockScore: fraudExtras.blockScore.trim() === '' ? null : Number(fraudExtras.blockScore),
      weights: Object.fromEntries(WEIGHT_LABELS.filter(([k]) => fraudExtras.weights[k].trim() !== '').map(([k]) => [k, Number(fraudExtras.weights[k])])),
      alertEmails: fraudExtras.alertEmails.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
    };
    // The stored webhook comes back masked; unchanged = keep it, emptied = remove it.
    const hook = fraudExtras.webhook.trim();
    if (hook !== (rules?.alertWebhookUrl ?? '')) body['alertWebhookUrl'] = hook === '' ? null : hook;
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    if (await putFraud.run(body as Partial<FraudConfig>)) { refetchRules(); onSaved(); onClose(); }
  };

  const saveSmtp = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...smtpForm };
    if (!body.password) delete body.password;
    if (await putSmtp.run(body)) { refetchSettings(); onSaved(); onClose(); }
  };

  if (active.type === 'link' && active.link) return null;

  return (
    <Modal open onClose={onClose} title={title}>
      {active.type === 'api-key' && (
        <form onSubmit={saveApiKey} className="space-y-3">
          {putIntegrations.error && <p className="text-small text-danger-text">{putIntegrations.error}</p>}
          <Field label={active.label ?? 'API Key'}>
            <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isSet(active.settingsKey!) ? '•••••••• (leave blank to keep)' : ''} required={!isSet(active.settingsKey!)} />
          </Field>
          <p className="text-tiny text-fg-muted">Credentials are stored in network settings and used to mark this integration connected.</p>
          <button type="submit" className="btn-primary" disabled={putIntegrations.busy}>{putIntegrations.busy ? 'Saving…' : 'Save integration'}</button>
        </form>
      )}
      {active.type === 'shopify' && (
        <form onSubmit={saveShopify} className="space-y-3">
          {putIntegrations.error && <p className="text-small text-danger-text">{putIntegrations.error}</p>}
          <Field label="Shopify Store URL"><input className="input" value={shopifyUrl} onChange={(e) => setShopifyUrl(e.target.value)} placeholder="https://yourstore.myshopify.com" required /></Field>
          <Field label="Admin API Key"><input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isSet('shopifyApiKey') ? '••••••••' : ''} /></Field>
          <button type="submit" className="btn-primary" disabled={putIntegrations.busy}>{putIntegrations.busy ? 'Saving…' : 'Save integration'}</button>
        </form>
      )}
      {active.type === 'agreement' && (
        <form onSubmit={saveAgreement} className="space-y-3">
          {putIntegrations.error && <p className="text-small text-danger-text">{putIntegrations.error}</p>}
          <Field label="Agreement Name"><input className="input" value={agreementName} onChange={(e) => setAgreementName(e.target.value)} required /></Field>
          <Field label="Document URL"><input className="input" value={agreementUrl} onChange={(e) => setAgreementUrl(e.target.value)} required /></Field>
          <button type="submit" className="btn-primary" disabled={putIntegrations.busy}>{putIntegrations.busy ? 'Saving…' : 'Save integration'}</button>
        </form>
      )}
      {active.type === 'facebook' && (
        <form onSubmit={saveFb} className="space-y-3">
          {putIntegrations.error && <p className="text-small text-danger-text">{putIntegrations.error}</p>}
          <Field label="Dataset / Pixel ID"><input className="input" value={fbForm.fbPixelId} onChange={(e) => setFbForm((f) => ({ ...f, fbPixelId: e.target.value }))} placeholder={cur['fbPixelId'] ? String(cur['fbPixelId']) : ''} /></Field>
          <Field label="Access Token"><input className="input" type="password" value={fbForm.fbAccessToken} onChange={(e) => setFbForm((f) => ({ ...f, fbAccessToken: e.target.value }))} placeholder={isSet('fbAccessToken') ? '••••••••' : ''} /></Field>
          <button type="submit" className="btn-primary" disabled={putIntegrations.busy}>{putIntegrations.busy ? 'Saving…' : 'Save integration'}</button>
        </form>
      )}
      {active.type === 'pin' && (
        <form onSubmit={savePin} className="space-y-3">
          {putIntegrations.error && <p className="text-small text-danger-text">{putIntegrations.error}</p>}
          <Field label="API Key"><input className="input" type="password" value={pinKey} onChange={(e) => setPinKey(e.target.value)} required /></Field>
          <button type="submit" className="btn-primary" disabled={putIntegrations.busy}>{putIntegrations.busy ? 'Saving…' : 'Save integration'}</button>
        </form>
      )}
      {active.type === 'fraud-rules' && (
        <form onSubmit={saveFraud} className="space-y-3">
          {putFraud.error && <p className="text-small text-danger-text">{putFraud.error}</p>}
          <label className="flex items-center gap-2 text-small"><input type="checkbox" className="chk" checked={fraudForm.enabled ?? rules?.enabled ?? true} onChange={(e) => setFraudForm((f) => ({ ...f, enabled: e.target.checked }))} /> Enable fraud scanning</label>
          {(['velocityPerMinute', 'minClickToConversionSeconds', 'minClicksForCrAlert', 'scanWindowHours'] as const).map((k) => (
            <Field key={k} label={k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}>
              <input className="input" type="number" value={fraudForm[k] ?? rules?.[k] ?? ''} onChange={(e) => setFraudForm((f) => ({ ...f, [k]: Number(e.target.value) }))} />
            </Field>
          ))}
          {(['datacenterRatioThreshold', 'botRatioThreshold', 'proxyRatioThreshold', 'crSpikeThreshold'] as const).map((k) => (
            <Field key={k} label={k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}>
              <input className="input" type="number" step="0.01" min="0" max="1" value={fraudForm[k] ?? rules?.[k] ?? ''} onChange={(e) => setFraudForm((f) => ({ ...f, [k]: Number(e.target.value) }))} />
            </Field>
          ))}

          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-small font-semibold text-fg">Blocking</p>
            <Field label="Block clicks at fraud score (1–100)">
              <input className="input" type="number" min="1" max="100" placeholder="Empty = flag only, never block"
                value={fraudExtras.blockScore} onChange={(e) => setFraudExtras((x) => ({ ...x, blockScore: e.target.value }))} />
            </Field>
            <p className="text-tiny text-fg-muted">Every click gets a score from the signals below. At or above this score the click is sent to the fallback URL (the offer’s, else the network’s) and not counted; below it the click is tracked and flagged. A server-to-server click is blocked only when it passes the visitor’s IP (<code>ip=</code>) — otherwise its IP is the partner’s server, so it’s scored but never blocked.</p>
          </div>

          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-small font-semibold text-fg">Signal weights (points added to the score, 0–100)</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {WEIGHT_LABELS.map(([k, label]) => (
                <Field key={k} label={label}>
                  <input className="input" type="number" min="0" max="100" value={fraudExtras.weights[k]}
                    onChange={(e) => setFraudExtras((x) => ({ ...x, weights: { ...x.weights, [k]: e.target.value } }))} />
                </Field>
              ))}
            </div>
            <p className="text-tiny text-fg-muted">IPQS signals need the IPQualityScore integration connected and enabled on the offer.</p>
          </div>

          <div className="space-y-3 border-t border-border pt-3">
            <p className="text-small font-semibold text-fg">Alert delivery</p>
            <Field label="Email new fraud alerts to (one per line, up to 20)">
              <textarea className="input min-h-[70px]" value={fraudExtras.alertEmails}
                onChange={(e) => setFraudExtras((x) => ({ ...x, alertEmails: e.target.value }))} placeholder="fraud@yourcompany.com" />
            </Field>
            <Field label="Webhook URL (POSTed as JSON for every new alert)">
              <input className="input" value={fraudExtras.webhook} placeholder="https://hooks.yourcompany.com/fraud"
                onChange={(e) => setFraudExtras((x) => ({ ...x, webhook: e.target.value }))} />
            </Field>
            {rules?.alertWebhookUrlSet && <p className="text-tiny text-fg-muted">A webhook is saved — only its address is shown. Leave it as is to keep it, or clear the field to remove it.</p>}
          </div>
          <button type="submit" className="btn-primary" disabled={putFraud.busy}>{putFraud.busy ? 'Saving…' : 'Save'}</button>
        </form>
      )}
      {active.type === 'smtp' && (
        <form onSubmit={saveSmtp} className="space-y-3">
          {putSmtp.error && <p className="text-small text-danger-text">{putSmtp.error}</p>}
          <Field label="Host"><input className="input" value={smtpForm.host ?? ''} onChange={(e) => setSmtpForm((f) => ({ ...f, host: e.target.value }))} required /></Field>
          <Field label="Port"><input className="input" type="number" value={smtpForm.port ?? 587} onChange={(e) => setSmtpForm((f) => ({ ...f, port: Number(e.target.value) }))} /></Field>
          <Field label="Username"><input className="input" value={smtpForm.username ?? ''} onChange={(e) => setSmtpForm((f) => ({ ...f, username: e.target.value }))} /></Field>
          <Field label={`Password${smtp.passwordSet ? ' (leave blank to keep)' : ''}`}><input className="input" type="password" value={smtpForm.password ?? ''} onChange={(e) => setSmtpForm((f) => ({ ...f, password: e.target.value }))} /></Field>
          <Field label="From Email"><input className="input" type="email" value={smtpForm.fromEmail ?? ''} onChange={(e) => setSmtpForm((f) => ({ ...f, fromEmail: e.target.value }))} required /></Field>
          <Field label="From Name"><input className="input" value={smtpForm.fromName ?? ''} onChange={(e) => setSmtpForm((f) => ({ ...f, fromName: e.target.value }))} /></Field>
          <label className="flex items-center gap-2 text-small"><input type="checkbox" className="chk" checked={smtpForm.secure ?? false} onChange={(e) => setSmtpForm((f) => ({ ...f, secure: e.target.checked }))} /> Use TLS/SSL</label>
          <button type="submit" className="btn-primary" disabled={putSmtp.busy}>{putSmtp.busy ? 'Saving…' : 'Save integration'}</button>
        </form>
      )}
    </Modal>
  );
}

// ── Everflow category tab ────────────────────────────────────────────────────

export function EverflowCategoryTab({ category }: { category: string }) {
  const navigate = useNavigate();
  const { data, loading, refetch } = useQuery<CategoryCatalog>(`/api/settings/integrations/catalog?category=${encodeURIComponent(category)}`);
  const [active, setActive] = useState<{ type: ConfigureType; cardId: string; settingsKey?: string; label?: string; link?: string } | null>(null);

  const handleConfigure = (cardId: string) => {
    const cfg = CONFIGURE[cardId];
    if (!cfg) return;
    if (cfg.type === 'link' && cfg.link) {
      void navigate(cfg.link);
      return;
    }
    setActive({ ...cfg, cardId });
  };

  if (loading) return <StateBlock><Spinner /></StateBlock>;

  const connected = data?.connected ?? [];
  const notConnected = data?.notConnected ?? [];

  return (
    <div className="space-y-4">
      <Accordion title="Connected" count={connected.length || undefined} defaultOpen>
        <CardList cards={connected} onConfigure={handleConfigure} />
      </Accordion>
      <Accordion title="Not connected" count={notConnected.length || undefined} defaultOpen>
        <CardList cards={notConnected} onConfigure={handleConfigure} />
      </Accordion>
      <ConfigureModals active={active} onClose={() => setActive(null)} onSaved={() => refetch()} />
    </div>
  );
}

// ── Tab exports (Everflow layout) ────────────────────────────────────────────

export function FraudDetectionTab() { return <EverflowCategoryTab category="Fraud Detection" />; }
export function SuppressionListTab() { return <EverflowCategoryTab category="Suppression List" />; }
export function BillingTab() { return <EverflowCategoryTab category="Billing" />; }
export function CrmTab() { return <EverflowCategoryTab category="CRM" />; }
export function ECommerceTab() { return <EverflowCategoryTab category="E-Commerce" />; }
export function PayPerCallTab() { return <EverflowCategoryTab category="Pay Per Call" />; }
export function EmailTab() { return <EverflowCategoryTab category="Email" />; }
export function ESignatureTab() { return <EverflowCategoryTab category="E-Signature" />; }
export function MmpTab() { return <EverflowCategoryTab category="MMP" />; }
export function MediaBuyingEverflowTab() { return <EverflowCategoryTab category="Media Buying" />; }

// Legacy export kept for Integrations.tsx row component
export function IntegrationRow({ name, desc, detail, action }: {
  name: string; desc: string; detail: string; action: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 last:border-0">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius)] bg-accent-subtle text-h3 font-bold text-accent-text">{name[0]}</div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-fg">{name}</p>
        <p className="text-small font-medium text-fg-secondary">{desc}</p>
        <p className="mt-1 text-tiny text-fg-muted">{detail}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
