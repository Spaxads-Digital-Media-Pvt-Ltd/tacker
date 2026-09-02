/**
 * Offers › Smart Links › Add / Edit — matches the reference's real 2-step "Add Smart Link" wizard
 * (verified live at /offers/campaigns/add): step 1 "General" (Name/Status/Labels/Tracking Domain/
 * Force SSL/Show to Partners), step 2 "Settings" (Catch-All Offer toggle, Redirect Mechanism
 * [KPI/Priority/Weight] + a KPI-config panel when KPI is chosen, and a bracket-connected "+"-row
 * per offer — Weight or Position depending on mechanism, Offer, Offer URL override) — the same
 * "+"-row pattern already used for Offer Templates' Prefilled Fields.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Field, Segmented } from '../../components/ui';
import { HelpIcon } from './controlCenter/shared';
import { REDIRECT_MECHANISMS, KPI_METRICS, KPI_RUN_FREQUENCIES, KPI_LOOKBACK_WINDOWS, type SmartLink, type SmartLinkItem } from '../../data/smartLinks';
import type { Offer, TrackingDomain } from '../../types';

interface Row { id: number; offerId: string; weight: number; position: number; offerUrl: string; country: string; open: boolean }
type Mechanism = (typeof REDIRECT_MECHANISMS)[number]['value'];

export default function SmartLinkForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const { data: existing } = useQuery<SmartLink & { items: SmartLinkItem[] }>(isEdit ? `/api/smart-links/${id}` : null);
  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: domains } = useQuery<TrackingDomain[]>('/api/tracking-domains');

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'paused' | 'deleted'>('active');
  const [labels, setLabels] = useState('');
  const [trackingDomainId, setTrackingDomainId] = useState('');
  const [forceSsl, setForceSsl] = useState(true);
  const [showToPartners, setShowToPartners] = useState(false);

  const [catchAll, setCatchAll] = useState(false);
  const [catchAllOfferId, setCatchAllOfferId] = useState('');
  const [mechanism, setMechanism] = useState<Mechanism>('weight');
  const [kpiRunFrequencyHours, setKpiRunFrequencyHours] = useState(12);
  const [kpiLookbackHours, setKpiLookbackHours] = useState(24);
  const [kpiMetric, setKpiMetric] = useState<string>('CVR');
  const [kpiMinClicks, setKpiMinClicks] = useState(100);
  const [rows, setRows] = useState<Row[]>([]);
  const nextId = useRef(1);
  const hydrated = useRef(false);

  const activeDomains = (domains ?? []).filter((d) => d.status === 'active');
  useEffect(() => { if (!isEdit && !trackingDomainId && activeDomains.length === 1) setTrackingDomainId(activeDomains[0]!.id); }, [isEdit, trackingDomainId, activeDomains]);

  useEffect(() => {
    if (existing && !hydrated.current) {
      hydrated.current = true;
      setName(existing.name);
      setStatus(existing.status as typeof status);
      setLabels(existing.labels ?? '');
      setTrackingDomainId(existing.trackingDomainId ?? '');
      setForceSsl(existing.forceSsl);
      setShowToPartners(existing.showToPartners);
      setCatchAll(!!existing.catchAllOfferId);
      setCatchAllOfferId(existing.catchAllOfferId ?? '');
      setMechanism(existing.redirectMechanism);
      setKpiRunFrequencyHours(existing.kpiRunFrequencyHours ?? 12);
      setKpiLookbackHours(existing.kpiLookbackHours ?? 24);
      setKpiMetric(existing.kpiMetric ?? 'CVR');
      setKpiMinClicks(existing.kpiMinClicks ?? 100);
      setRows(existing.items.map((it) => ({ id: nextId.current++, offerId: it.offerId, weight: it.weight, position: it.position ?? 1, offerUrl: it.offerUrl ?? '', country: it.country ?? '', open: true })));
    }
  }, [existing]);

  const addRow = () => setRows((r) => [...r, { id: nextId.current++, offerId: '', weight: 1, position: r.length + 1, offerUrl: '', country: '', open: true }]);
  const removeRow = (rid: number) => setRows((r) => r.filter((x) => x.id !== rid));
  const patchRow = (rid: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.id === rid ? { ...x, ...patch } : x)));
  const toggleOpen = (rid: number) => setRows((r) => r.map((x) => (x.id === rid ? { ...x, open: !x.open } : x)));

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/smart-links/${id}`, body) : api.post('/api/smart-links', body));

  const submit = async () => {
    const body: Record<string, unknown> = {
      name, status, labels: labels || null, trackingDomainId: trackingDomainId || null, forceSsl, showToPartners,
      catchAllOfferId: catchAll ? (catchAllOfferId || null) : null, redirectMechanism: mechanism,
      items: rows.filter((r) => r.offerId).map((r) => ({
        offerId: r.offerId, weight: r.weight, position: mechanism === 'priority' ? r.position : null,
        offerUrl: r.offerUrl || null, country: r.country || null,
      })),
    };
    if (mechanism === 'kpi') Object.assign(body, { kpiRunFrequencyHours, kpiLookbackHours, kpiMetric, kpiMinClicks });
    const res = await run(body);
    if (res !== null) nav('/app/smart-links');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Smart Link' : 'Add Smart Link'} subtitle={`Offers › Smart Links › ${isEdit ? 'Edit' : 'Add'}`} />

      <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-6 border-b border-border pb-4">
        {(['General', 'Settings'] as const).map((label, i) => {
          const n = (i + 1) as 1 | 2;
          const on = step === n;
          return (
            <button key={label} type="button" onClick={() => setStep(n)} className="flex items-center gap-2">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-tiny font-semibold ${on ? 'bg-accent text-accent-fg' : 'border border-border text-fg-secondary'}`}>{n}</span>
              <span className={`text-small font-medium ${on ? 'text-accent-text' : 'text-fg-secondary'}`}>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="card space-y-5">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <p className="flex items-center gap-1.5 text-tiny text-fg-secondary"><HelpIcon text="Required" /> Fields with an asterisk (*) are mandatory.</p>

        {step === 1 ? (
          <div className="max-w-md space-y-4">
            <Field label="Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Status *">
              <Segmented
                options={['active', 'paused', 'deleted']}
                value={status}
                onChange={(v) => setStatus(v as typeof status)}
                dots={{ active: 'bg-success', paused: 'bg-warning', deleted: 'bg-danger' }}
              />
            </Field>
            <Field label="Labels"><textarea className="input min-h-[70px]" value={labels} onChange={(e) => setLabels(e.target.value)} /></Field>
            <Field label="Tracking Domain *">
              <select className="input" required value={trackingDomainId} onChange={(e) => setTrackingDomainId(e.target.value)}>
                <option value="">Select Tracking Domain…</option>
                {activeDomains.map((d) => <option key={d.id} value={d.id}>{d.host}</option>)}
              </select>
            </Field>
            <div className="flex items-center gap-8 pt-1">
              <label className="flex items-center gap-2 text-small font-medium text-fg">Force SSL <HelpIcon text="Serve this Smart Link's redirects over HTTPS." /><input type="checkbox" className="chk" checked={forceSsl} onChange={(e) => setForceSsl(e.target.checked)} /></label>
              <label className="flex items-center gap-2 text-small font-medium text-fg">Show to Partners <HelpIcon text="Make this Smart Link's tracking URL visible to Partners in the Partner Portal." /><input type="checkbox" className="chk" checked={showToPartners} onChange={(e) => setShowToPartners(e.target.checked)} /></label>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl space-y-5">
            <Field label="Catch-All Offer">
              <button type="button" onClick={() => setCatchAll((v) => !v)}
                className={`flex w-24 items-center rounded-full border border-border p-0.5 text-tiny font-medium ${catchAll ? 'justify-end bg-accent-subtle text-accent-text' : 'justify-start text-fg-secondary'}`}>
                <span className="rounded-full bg-surface px-2 py-1 shadow-sm">{catchAll ? 'Yes' : 'No'}</span>
              </button>
            </Field>
            {catchAll && (
              <Field label="Catch-All Offer *">
                <select className="input" value={catchAllOfferId} onChange={(e) => setCatchAllOfferId(e.target.value)}>
                  <option value="">Select Offer…</option>
                  {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.ref != null ? `${o.name} (${o.ref})` : o.name}</option>)}
                </select>
              </Field>
            )}

            <div className="flex items-end gap-2">
              <div className="flex-1"><Field label="Redirect Mechanism *">
                <select className="input" value={mechanism} onChange={(e) => setMechanism(e.target.value as Mechanism)}>
                  {REDIRECT_MECHANISMS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field></div>
              <button type="button" onClick={addRow} title="Add an offer" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg"><Plus size={15} /></button>
            </div>

            {mechanism === 'kpi' && (
              <div className="rounded-card border border-border bg-page p-4">
                <p className="mb-3 text-small font-semibold text-fg">KPI-based Smart Link Configuration</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Run Frequency"><select className="input" value={kpiRunFrequencyHours} onChange={(e) => setKpiRunFrequencyHours(Number(e.target.value))}>{KPI_RUN_FREQUENCIES.map((h) => <option key={h} value={h}>{h} Hours</option>)}</select></Field>
                  <Field label="Data Lookback Window"><select className="input" value={kpiLookbackHours} onChange={(e) => setKpiLookbackHours(Number(e.target.value))}>{KPI_LOOKBACK_WINDOWS.map((h) => <option key={h} value={h}>{h} Hours</option>)}</select></Field>
                  <Field label="Metric"><select className="input" value={kpiMetric} onChange={(e) => setKpiMetric(e.target.value)}>{KPI_METRICS.map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
                  <Field label="Data Collection Period Threshold"><input type="number" min={1} className="input" value={kpiMinClicks} onChange={(e) => setKpiMinClicks(Number(e.target.value))} /></Field>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {rows.map((row) => {
                const rowOffer = (offers ?? []).find((o) => o.id === row.offerId);
                return (
                <div key={row.id} className="ml-3 flex items-start gap-2 border-l-2 border-border pl-4">
                  <div className="w-full rounded-card border border-border bg-page p-3">
                    <button type="button" onClick={() => toggleOpen(row.id)} className="mb-2 flex w-full items-center gap-1.5 text-left text-small font-medium text-fg-secondary hover:text-fg">
                      {row.open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                      {rowOffer ? (rowOffer.ref != null ? `${rowOffer.name} (${rowOffer.ref})` : rowOffer.name) : <span className="text-fg-muted">New offer</span>}
                    </button>
                    {row.open && (
                      <div className="space-y-3">
                        {mechanism === 'weight' && (
                          <Field label="Weight *"><input type="number" min={0} max={9} className="input !w-24" value={row.weight} onChange={(e) => patchRow(row.id, { weight: Number(e.target.value) })} /></Field>
                        )}
                        {mechanism === 'priority' && (
                          <Field label="Position *"><input type="number" min={1} className="input !w-24" value={row.position} onChange={(e) => patchRow(row.id, { position: Number(e.target.value) })} /></Field>
                        )}
                        <Field label="Offer *">
                          <select className="input" value={row.offerId} onChange={(e) => patchRow(row.id, { offerId: e.target.value })}>
                            <option value="">Select Offer…</option>
                            {(offers ?? []).map((o) => <option key={o.id} value={o.id}>{o.ref != null ? `${o.name} (${o.ref})` : o.name}</option>)}
                          </select>
                        </Field>
                        {row.offerId && (
                          <div className="ml-3 rounded-card border border-border bg-surface p-3">
                            <Field label="Offer URL" hint="Optional per-offer URL override. Stored on the rotation item, but /sl currently redirects to the offer's own landing page — not applied at redirect time yet.">
                              <input className="input" type="url" placeholder="Uses the offer's default landing page" value={row.offerUrl} onChange={(e) => patchRow(row.id, { offerUrl: e.target.value })} />
                            </Field>
                          </div>
                        )}
                        <Field label="Country target (optional, ISO-2)"><input className="input !w-24" placeholder="US" value={row.country} onChange={(e) => patchRow(row.id, { country: e.target.value.toUpperCase() })} /></Field>
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => removeRow(row.id)} title="Remove"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-danger-bg hover:text-danger-text">
                    <Trash2 size={14} />
                  </button>
                </div>
                );
              })}
              {rows.length === 0 && <p className="text-small text-fg-muted">No offers yet. Use the + button to add one.</p>}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          {step === 1 ? (
            <>
              <button type="button" className="btn-ghost" onClick={() => nav('/app/smart-links')}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!name || !trackingDomainId} onClick={() => setStep(2)}>Next</button>
            </>
          ) : (
            <>
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>Back</button>
              <button type="button" className="btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
            </>
          )}
        </div>
      </div>
      </div>
    </>
  );
}
