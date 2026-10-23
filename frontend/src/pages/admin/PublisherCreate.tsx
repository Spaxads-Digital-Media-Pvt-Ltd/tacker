/**
 * Add Partner (Everflow-style 4-step wizard: General/Address/Billing/User).
 * POSTs to /api/publishers on the final step. Every field the backend stores is wired (same
 * sources/options as Partner Edit); the few preferences with no backing field are labelled as such.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { useSubmitGuard } from '../../lib/useSubmitGuard';
import { PageHeader, Field, Segmented, Spinner } from '../../shared-components/primitives/ui';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { Stepper } from '../../shared-components/panels/Stepper';
import { ToggleRow } from '../../shared-components/primitives/ToggleRow';
import { FormLayout } from '../../shared-components/forms/FormLayout';
import { FormSection } from '../../shared-components/forms/FormSection';
import { FormFooter } from '../../shared-components/forms/FormFooter';
import { UpNextCard } from '../../shared-components/forms/UpNextCard';
import { StatusChoice } from '../../shared-components/forms/ChoiceCards';
import { LabelsInput } from '../../shared-components/panels/LabelsEditor';
import type { DashboardUser, Publisher } from '../../types';

const STEPS = ['General', 'Address', 'Billing', 'User'];
const STATUS_OPTIONS = [
 { value: 'active', label: 'Active', tone: 'success' }, { value: 'pending', label: 'Pending', tone: 'warning' }, { value: 'inactive', label: 'Inactive', tone: 'danger' },
] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
 name: string;
 status: string;
 contactEmail: string;
 trafficSource: string;
 payoutTerms: string;
 country: string;
 tier: string;
 partnerManagerId: string;
 /** Control Center channel id ('' = none). */
 channelId: string;
 accountExecutiveId: string;
 referredById: string;
 billingFrequency: string;
 paymentMethod: string;
 taxId: string;
 notes: string;
 contactFirstName: string;
 contactLastName: string;
}

const INITIAL_FORM: FormState = {
 name: '',
 status: 'active',
 contactEmail: '',
 trafficSource: '',
 payoutTerms: '',
 country: '',
 tier: '',
 partnerManagerId: '',
 channelId: '',
 accountExecutiveId: '',
 referredById: '',
 billingFrequency: '',
 paymentMethod: '',
 taxId: '',
 notes: '',
 contactFirstName: '',
 contactLastName: '',
};

export default function PublisherCreate() {
 const nav = useNavigate();
 const confirm = useConfirm();
 const [step, setStep] = useState(0);
 const [form, setForm] = useState<FormState>(INITIAL_FORM);
 const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

 const set = (k: keyof FormState, v: string) => {
 setForm((f) => ({ ...f, [k]: v }));
 setFieldErrors((errs) => { const next = { ...errs }; delete next[k]; return next; });
 };

 const [notify, setNotify] = useState(true);
 const [dynamicPayouts, setDynamicPayouts] = useState(false);
 const [labels, setLabels] = useState<string[]>([]);
 const [trafficSourceEnabled, setTrafficSourceEnabled] = useState(false);
 const [macroVisibility, setMacroVisibility] = useState('None');
 const [addressEnabled, setAddressEnabled] = useState(false);
 const [accountExec, setAccountExec] = useState(false);
 const [referredBy, setReferredBy] = useState(false);
 const [partnerTier, setPartnerTier] = useState(false);

 const { data: users } = useQuery<DashboardUser[]>('/api/users');
 const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
 const { data: channels } = useQuery<Array<{ id: string; name: string }>>('/api/control-center/channels?status=active');
 const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/publishers', body));
 // One lock for the whole create flow (POST + label follow-ups) — see useSubmitGuard.
 const { pending: submitting, guard } = useSubmitGuard();

 const validateStep0 = (): boolean => {
 const errs: Partial<Record<keyof FormState, string>> = {};
 if (!form.name.trim()) errs.name = 'Name is required.';
 if (form.contactEmail && !EMAIL_RE.test(form.contactEmail)) errs.contactEmail = 'Enter a valid email address.';
 if (Object.keys(errs).length > 0) setFieldErrors(errs);
 return Object.keys(errs).length === 0;
 };

 const validateStep3 = (): boolean => {
 const errs: Partial<Record<keyof FormState, string>> = {};
 // Optional (the API stores it nullable) — only its format is checked when one is given.
 if (form.contactEmail.trim() && !EMAIL_RE.test(form.contactEmail)) errs.contactEmail = 'Enter a valid email address.';
 setFieldErrors(errs);
 return Object.keys(errs).length === 0;
 };

 /** Resolves true once the partner exists and we're navigating to it (keeps the button locked). */
 const createPartner = async (): Promise<boolean> => {
 const body: Record<string, unknown> = {
 name: form.name.trim(),
 status: form.status,
 contactEmail: form.contactEmail.trim() || undefined,
 contactName: [form.contactFirstName, form.contactLastName].filter(Boolean).join(' ') || undefined,
 payoutTerms: form.payoutTerms.trim() || undefined,
 country: form.country || undefined,
 tier: partnerTier ? form.tier.trim() || undefined : undefined,
 partnerManagerId: form.partnerManagerId || undefined,
 channelId: form.channelId || null,
 accountExecutiveId: accountExec ? form.accountExecutiveId || undefined : undefined,
 referredById: referredBy ? form.referredById || undefined : undefined,
 billingFrequency: form.billingFrequency || undefined,
 paymentMethod: form.paymentMethod || undefined,
 taxId: form.taxId.trim() || undefined,
 notes: form.notes || undefined,
 trafficSource: trafficSourceEnabled ? form.trafficSource || undefined : undefined,
 };
 const res = await run(body);
 if (!res) return false;
 // The partner exists now — a failed label must not strand the user on the wizard (a resubmit
 // would create a duplicate partner), so report it and carry on to the new partner.
 const failedLabels: string[] = [];
 for (const name of labels) {
 try { await api.post(`/api/publishers/${res.id}/tags`, { name }); } catch { failedLabels.push(name); }
 }
 if (failedLabels.length) await confirm({ title: 'Partner created with warnings', message: `Partner created, but these labels could not be added: ${failedLabels.join(', ')}`, cancelLabel: null });
 nav(`/app/publishers/${res.id}`);
 return true;
 };

 const next = (e: FormEvent) => {
 e.preventDefault();
 if (submitting) return;
 if (step === 0 && !validateStep0()) return;
 if (step < STEPS.length - 1) { setStep(step + 1); }
 else { if (validateStep3()) void guard(createPartner); }
 };

 const isLast = step === STEPS.length - 1;
 const locked = busy || submitting;

 return (
 <>
 <PageHeader title="Add Partner" subtitle="Partners › Add" />
 <Stepper steps={STEPS} current={step} />
 <form onSubmit={next} noValidate>
 <FormLayout caption={`Step ${step + 1}`} title={STEPS[step]} requiredNote="Fields with an asterisk (*) are mandatory." layout="centered"
 upNext={isLast ? undefined : <UpNextCard number={step + 2} name={STEPS[step + 1]!} />}>
 <div className="space-y-6">
 {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}

 {step === 0 && (
 <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:items-start">
 <div className="md:col-span-2">
 <Field label="Name *" error={fieldErrors.name}>
 <input className="input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
 </Field>
 </div>
 <div className="md:col-span-2">
 <span id="partner-status-label" className="label">Status *</span>
 <StatusChoice options={STATUS_OPTIONS} value={form.status as (typeof STATUS_OPTIONS)[number]['value']} onChange={(v) => set('status', v)} ariaLabelledby="partner-status-label" />
 </div>
 <Field label="Partner Manager">
 <select className="input" value={form.partnerManagerId} onChange={(e) => set('partnerManagerId', e.target.value)}>
 <option value="">— Select —</option>
 {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
 </select>
 </Field>
 <Field label="Channel">
 <select className="input" value={form.channelId} onChange={(e) => set('channelId', e.target.value)}>
 <option value="">None</option>
 {(channels ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
 </select>
 </Field>
 <div className="space-y-2">
 <ToggleRow label="Account Executive" checked={accountExec} onChange={setAccountExec} />
 {accountExec && <select className="input" aria-label="Account Executive" value={form.accountExecutiveId} onChange={(e) => set('accountExecutiveId', e.target.value)}>
 <option value="">— Select —</option>
 {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
 </select>}
 </div>
 <div className="space-y-2">
 <ToggleRow label="Referred By" checked={referredBy} onChange={setReferredBy} />
 {referredBy && <select className="input" aria-label="Referred By" value={form.referredById} onChange={(e) => set('referredById', e.target.value)}>
 <option value="">— Select —</option>
 {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
 </select>}
 </div>
 <div className="space-y-2">
 <ToggleRow label="Partner Tier" checked={partnerTier} onChange={setPartnerTier} />
 {partnerTier && <input className="input" aria-label="Partner Tier" value={form.tier} onChange={(e) => set('tier', e.target.value)} placeholder="e.g. Gold, Silver, Bronze" />}
 </div>
 <div className="md:col-span-2"><LabelsInput value={labels} onChange={setLabels} /></div>
 <label className="flex items-center gap-3 text-small text-fg">
 <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 rounded border-border" />
 Allow partner to receive notifications
 </label>
 <label className="flex items-center gap-3 text-small text-fg">
 <input type="checkbox" checked={dynamicPayouts} onChange={(e) => setDynamicPayouts(e.target.checked)} className="h-4 w-4 rounded border-border" />
 Enable CPC/CPM Dynamic Payouts
 </label>
 {/* Optional fields only — collapsed by default, kept mounted while collapsed. */}
 <FormSection id="partner-optional" title="Optional details" collapsible className="md:col-span-2"
 summary="Traffic Source · Internal Notes · Set Macro Parameter Visibility"
 filledCount={(trafficSourceEnabled ? 1 : 0) + (form.notes.trim() ? 1 : 0)}>
 <div className="space-y-4 pt-2">
 <div className="space-y-2">
 <ToggleRow label="Traffic Source" checked={trafficSourceEnabled} onChange={setTrafficSourceEnabled} />
 {trafficSourceEnabled && (
 <input className="input" aria-label="Traffic Source" value={form.trafficSource} onChange={(e) => set('trafficSource', e.target.value)} placeholder="Push, Native, Social…" />
 )}
 </div>
 <Field label="Internal Notes">
 <textarea className="input min-h-[80px]" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Notes for internal use…" />
 </Field>
 <Field label="Set Macro Parameter Visibility">
 <Segmented options={['None', 'Custom', 'Full access']} value={macroVisibility} onChange={setMacroVisibility} />
 </Field>
 </div>
 </FormSection>
 <p className="text-[11px] text-fg-muted md:col-span-2">Notification, dynamic-payout and macro-visibility preferences are not stored yet.</p>
 </div>
 )}

 {step === 1 && (
 <div className="space-y-4">
 <label className="flex items-center gap-3 text-small text-fg">
 <input type="checkbox" checked={addressEnabled} onChange={(e) => setAddressEnabled(e.target.checked)} className="h-4 w-4 rounded border-border" />
 Enable Address
 </label>
 {addressEnabled && (
 <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
 <Field label="Country"><input className="input" value={form.country} onChange={(e) => set('country', e.target.value)} /></Field>
 <Field label="Address Line 1"><input className="input" /></Field>
 <Field label="Address Line 2"><input className="input" /></Field>
 <Field label="City"><input className="input" /></Field>
 <Field label="State / Region"><input className="input" /></Field>
 <Field label="ZIP / Postal Code"><input className="input" /></Field>
 </div>
 )}
 </div>
 )}

 {step === 2 && (
 <div className="space-y-4">
 <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
 <Field label="Billing Frequency">
 <select className="input" value={form.billingFrequency} onChange={(e) => set('billingFrequency', e.target.value)}>
 <option value="">—</option>
 {['Weekly', 'Bi-Weekly', 'Monthly', 'Net 15', 'Net 30'].map((f) => <option key={f} value={f}>{f}</option>)}
 </select>
 </Field>
 <Field label="Payout Terms">
 <textarea className="input min-h-[80px]" value={form.payoutTerms} onChange={(e) => set('payoutTerms', e.target.value)} placeholder="Net-30, minimum $50…" />
 </Field>
 </div>
 <Field label="Payment Method">
 <select className="input md:!w-auto" value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
 <option value="">—</option>
 {['Wire', 'Paypal', 'Webmoney', 'Direct Deposit', 'None'].map((m) => <option key={m} value={m}>{m}</option>)}
 </select>
 </Field>
 {form.paymentMethod && form.paymentMethod !== 'None' && (
 <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 md:grid-cols-2">
 <Field label="Bank Name"><input className="input" /></Field>
 <Field label="Account Number"><input className="input" /></Field>
 <p className="text-[11px] text-fg-muted md:col-span-2">Bank details are not stored yet.</p>
 </div>
 )}
 <Field label="Tax ID / VAT or SSN"><input className="input" value={form.taxId} onChange={(e) => set('taxId', e.target.value)} /></Field>
 </div>
 )}

 {step === 3 && (
 <div className="space-y-4">
 <p className="text-small text-fg-secondary">Create a login for this partner to access their portal.</p>
 <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
 <Field label="First Name">
 <input className="input" value={form.contactFirstName} onChange={(e) => set('contactFirstName', e.target.value)} />
 </Field>
 <Field label="Last Name">
 <input className="input" value={form.contactLastName} onChange={(e) => set('contactLastName', e.target.value)} />
 </Field>
 </div>
 <Field label="Email" error={fieldErrors.contactEmail}>
 <input type="email" className="input" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
 </Field>
 <p className="text-[11px] text-fg-muted">Portal user creation is handled separately from this form.</p>
 </div>
 )}
 </div>
 </FormLayout>

 <FormFooter
 stepText={`Step ${step + 1} of ${STEPS.length}`}
 cancel={<button type="button" className="btn-ghost" onClick={() => (step === 0 ? nav('/app/publishers') : setStep(step - 1))}>
 {step === 0 ? 'Cancel' : 'Back'}
 </button>}
 primary={{
 label: locked ? <span className="inline-flex items-center gap-2"><Spinner /> Creating…</span> : isLast ? 'Create Partner' : `Next: ${STEPS[step + 1]}`,
 shortLabel: locked || isLast ? undefined : 'Next',
 disabled: locked, busy: locked,
 }} />
 </form>
 </>
 );
}
