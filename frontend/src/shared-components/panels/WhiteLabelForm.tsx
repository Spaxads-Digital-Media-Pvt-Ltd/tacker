/**
 * White-label settings — a network's own brand on a dashboard domain of its own. Used in two places:
 * Super Admin › Networks › White-label (`platform`: may grant it — the Enabled switch) and the network's
 * Control Center › Platform (only once granted). Brand name, primary colour, support link, hide the
 * platform's branding, and the dashboard domain with the DNS TXT record that verifies it.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { Field, Spinner, StateBlock } from '../primitives/ui';
import { CopyBox } from './CopyBox';
import type { WhiteLabel } from '../../lib/platformResellers';

export function WhiteLabelForm({ base, platform = false, canEdit }: { base: string; platform?: boolean; canEdit: boolean }) {
  const q = useQuery<WhiteLabel>(base);
  const [f, setF] = useState({ enabled: false, brandName: '', primaryColor: '', supportUrl: '', hidePlatformBranding: false, dashboardDomain: '' });
  useEffect(() => {
    if (!q.data) return;
    setF({
      enabled: q.data.enabled, brandName: q.data.brandName ?? '', primaryColor: q.data.primaryColor ?? '', supportUrl: q.data.supportUrl ?? '',
      hidePlatformBranding: q.data.hidePlatformBranding, dashboardDomain: q.data.dashboardDomain ?? '',
    });
  }, [q.data]);
  const save = useMutation((body: Record<string, unknown>) => api.put<WhiteLabel>(base, body));
  const verify = useMutation(() => api.post<WhiteLabel>(`${base}/verify`, {}));
  const [saved, setSaved] = useState(false);
  if (q.loading && !q.data) return <StateBlock><Spinner /></StateBlock>;
  if (q.error || !q.data) return <StateBlock>{q.error ?? 'Could not load the white-label settings'}</StateBlock>;
  const wl = q.data;
  const locked = !platform && !wl.enabled;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const body: Record<string, unknown> = {
      brandName: f.brandName.trim() || null, primaryColor: f.primaryColor.trim() || null, supportUrl: f.supportUrl.trim() || null,
      hidePlatformBranding: f.hidePlatformBranding, dashboardDomain: f.dashboardDomain.trim() || null,
      ...(platform ? { enabled: f.enabled } : {}),
    };
    if (await save.run(body)) { setSaved(true); q.refetch(); }
  };
  const disabled = !canEdit || locked;
  return (
    <form onSubmit={submit} className="space-y-4">
      {locked && <p className="rounded-[var(--radius)] bg-page px-3 py-2 text-small text-fg-secondary ring-1 ring-inset ring-border">White-label isn’t part of this network’s plan yet — ask the platform team to turn it on.</p>}
      {save.error && <p className="text-small text-danger-text">{save.error}</p>}
      {saved && !save.error && <p className="text-small text-success-text">Saved.</p>}
      {platform && (
        <label className="flex items-center gap-2 text-small text-fg">
          <input type="checkbox" className="h-4 w-4 rounded border-border" checked={f.enabled} disabled={!canEdit} onChange={(e) => setF((s) => ({ ...s, enabled: e.target.checked }))} />
          White-label enabled for this network (it can then set up its own brand and domain)
        </label>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Brand name"><input className="input" maxLength={80} disabled={disabled} value={f.brandName} onChange={(e) => setF((s) => ({ ...s, brandName: e.target.value }))} placeholder="Shown instead of the platform's name" /></Field>
        <Field label="Primary colour">
          <div className="flex items-center gap-2">
            <input type="color" className="h-9 w-12 cursor-pointer rounded border border-border" disabled={disabled} value={/^#[0-9a-fA-F]{6}$/.test(f.primaryColor) ? f.primaryColor : '#0d9488'} onChange={(e) => setF((s) => ({ ...s, primaryColor: e.target.value }))} />
            <input className="input font-mono" maxLength={7} disabled={disabled} value={f.primaryColor} onChange={(e) => setF((s) => ({ ...s, primaryColor: e.target.value }))} placeholder="#1E3557" />
          </div>
        </Field>
        <Field label="Support link"><input className="input" maxLength={500} disabled={disabled} value={f.supportUrl} onChange={(e) => setF((s) => ({ ...s, supportUrl: e.target.value }))} placeholder="https://help.example.com" /></Field>
        <Field label="Dashboard domain"><input className="input font-mono" maxLength={253} disabled={disabled} value={f.dashboardDomain} onChange={(e) => setF((s) => ({ ...s, dashboardDomain: e.target.value }))} placeholder="dashboard.example.com" /></Field>
      </div>
      <label className="flex items-center gap-2 text-small text-fg">
        <input type="checkbox" className="h-4 w-4 rounded border-border" disabled={disabled} checked={f.hidePlatformBranding} onChange={(e) => setF((s) => ({ ...s, hidePlatformBranding: e.target.checked }))} />
        Hide the platform’s branding on the dashboard domain
      </label>
      {wl.dashboardDomain && (
        <div className="space-y-2 rounded-[var(--radius)] bg-page px-3 py-3 ring-1 ring-inset ring-border">
          <p className="text-small font-medium text-fg">
            {wl.dashboardDomain}: {wl.domainVerified ? <span className="text-success-text">verified</span> : <span className="text-warning-text">not verified yet</span>}
          </p>
          {!wl.domainVerified && wl.dnsRecord && (
            <>
              <p className="text-tiny text-fg-secondary">1. Point <code>{wl.dashboardDomain}</code> at this dashboard (a CNAME to the app’s host). 2. Publish this TXT record, then check:</p>
              <p className="text-tiny text-fg-secondary">Name</p><CopyBox value={wl.dnsRecord.name} />
              <p className="text-tiny text-fg-secondary">Value</p><CopyBox value={wl.dnsRecord.value} />
            </>
          )}
          {wl.domainCheckResult && <p className="text-tiny text-fg-secondary">Last check: {wl.domainCheckResult}</p>}
          {canEdit && !locked && (
            <button type="button" className="btn-ghost" disabled={verify.busy} onClick={async () => { if (await verify.run(undefined)) q.refetch(); }}>{verify.busy ? 'Checking…' : 'Check DNS now'}</button>
          )}
          {verify.error && <p className="text-small text-danger-text">{verify.error}</p>}
        </div>
      )}
      {canEdit && !locked && <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save white-label'}</button></div>}
    </form>
  );
}
