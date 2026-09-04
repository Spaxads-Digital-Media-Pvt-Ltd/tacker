/**
 * Add Partner (Everflow-style 4-step wizard: General/Address/Billing/User).
 * POSTs to /api/publishers on the final step with the fields the backend schema supports.
 * Fields without backend support are shown as inert controls for layout parity.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { PageHeader, Field, Segmented, Spinner } from '../../components/ui';
import { Stepper } from '../../components/Stepper';

const STEPS = ['General', 'Address', 'Billing', 'User'];
const STATUSES = ['active', 'pending', 'inactive'] as const;
const STATUS_DOT: Record<string, string> = { active: 'bg-success', pending: 'bg-warning', inactive: 'bg-danger' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
 name: string;
 status: string;
 contactEmail: string;
 trafficSource: string;
 payoutTerms: string;
 country: string;
 currency: string;
 tier: string;
 partnerManagerId: string;
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
 currency: 'USD',
 tier: '',
 partnerManagerId: '',
 notes: '',
 contactFirstName: '',
 contactLastName: '',
};

export default function PublisherCreate() {
 const nav = useNavigate();
 const [step, setStep] = useState(0);
 const [form, setForm] = useState<FormState>(INITIAL_FORM);
 const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});

 const set = (k: keyof FormState, v: string) => {
 setForm((f) => ({ ...f, [k]: v }));
 setFieldErrors((errs) => { const next = { ...errs }; delete next[k]; return next; });
 };

 const [notify, setNotify] = useState(true);
 const [dynamicPayouts, setDynamicPayouts] = useState(false);
 const [trafficSourceEnabled, setTrafficSourceEnabled] = useState(false);
 const [macroVisibility, setMacroVisibility] = useState('None');
 const [addressEnabled, setAddressEnabled] = useState(false);
 const [paymentEnabled, setPaymentEnabled] = useState(true);
 const [accountExec, setAccountExec] = useState(false);
 const [referredBy, setReferredBy] = useState(false);
 const [partnerTier, setPartnerTier] = useState(false);

 const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/publishers', body));

 const validateStep0 = (): boolean => {
 const errs: Partial<Record<keyof FormState, string>> = {};
 if (!form.name.trim()) errs.name = 'Name is required.';
 if (form.contactEmail && !EMAIL_RE.test(form.contactEmail)) errs.contactEmail = 'Enter a valid email address.';
 if (Object.keys(errs).length > 0) setFieldErrors(errs);
 return Object.keys(errs).length === 0;
 };

 const validateStep3 = (): boolean => {
 const errs: Partial<Record<keyof FormState, string>> = {};
 if (!form.contactEmail.trim()) errs.contactEmail = 'Email is required for the portal login.';
 else if (!EMAIL_RE.test(form.contactEmail)) errs.contactEmail = 'Enter a valid email address.';
 setFieldErrors(errs);
 return Object.keys(errs).length === 0;
 };

 const submit = async () => {
 const body: Record<string, unknown> = {
 name: form.name.trim(),
 status: form.status,
 contactEmail: form.contactEmail || undefined,
 contactName: [form.contactFirstName, form.contactLastName].filter(Boolean).join(' ') || undefined,
 payoutTerms: form.payoutTerms || undefined,
 country: form.country || undefined,
 currency: form.currency,
 tier: form.tier || undefined,
 partnerManagerId: form.partnerManagerId || undefined,
 notes: form.notes || undefined,
 trafficSource: trafficSourceEnabled ? form.trafficSource || undefined : undefined,
 };
 const res = await run(body);
 if (res) {
 nav(`/app/publishers/${res.id}`);
 }
 };

 const next = (e: FormEvent) => {
 e.preventDefault();
 if (step === 0 && !validateStep0()) return;
 if (step < STEPS.length - 1) { setStep(step + 1); }
 else { if (validateStep3()) submit(); }
 };

 const fieldClass = (k: keyof FormState) => (fieldErrors[k] ? 'input !border-danger' : 'input');
 const fieldError = (k: keyof FormState) => (fieldErrors[k] ? <p className="mt-1 text-tiny text-danger-text">{fieldErrors[k]}</p> : null);

 return (
 <>
 <PageHeader title="Add Partner" subtitle="Partners › Add" />
 <Stepper steps={STEPS} current={step} />
 <div className="max-w-2xl mx-auto">
 <form onSubmit={next} className="card space-y-6" noValidate>
 {error && <p className="rounded-lg bg-danger-bg px-4 py-3 text-small text-danger-text">{error}</p>}
 <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>

 {step === 0 && (
 <div className="space-y-4">
 <Field label="Name *">
 <input className={fieldClass('name')} required value={form.name} onChange={(e) => set('name', e.target.value)} />
 {fieldError('name')}
 </Field>
 <div>
 <label className="label mb-2 block">Status *</label>
 <Segmented options={STATUSES} value={form.status} onChange={(v) => set('status', v)} dots={STATUS_DOT} />
 </div>
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <Field label="Partner Manager">
 <select className="input" value={form.partnerManagerId} onChange={(e) => set('partnerManagerId', e.target.value)}>
 <option value="">— Select —</option>
 <option value="placeholder-uuid">Not available yet</option>
 </select>
 </Field>
 <div>
 <label className="label mb-2 block">Account Executive</label>
 <div className="flex items-center gap-2">
 <button type="button" onClick={() => setAccountExec(!accountExec)}
 className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${accountExec ? 'text-accent-text' : 'text-fg-secondary'}`}>
 {accountExec ? 'Yes' : 'No'}
 <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${accountExec ? 'bg-success' : 'bg-border'}`}>
 <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${accountExec ? 'translate-x-[18px]' : 'translate-x-0'}`} />
 </span>
 </button>
 {accountExec && <select className="input"><option>Not available yet</option></select>}
 </div>
 </div>
 </div>
 <div>
 <label className="label mb-2 block">Referred By</label>
 <div className="flex items-center gap-2">
 <button type="button" onClick={() => setReferredBy(!referredBy)}
 className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${referredBy ? 'text-accent-text' : 'text-fg-secondary'}`}>
 {referredBy ? 'Yes' : 'No'}
 <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${referredBy ? 'bg-success' : 'bg-border'}`}>
 <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${referredBy ? 'translate-x-[18px]' : 'translate-x-0'}`} />
 </span>
 </button>
 {referredBy && <select className="input"><option>Not available yet</option></select>}
 </div>
 </div>
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <Field label="Currency">
 <input className="input" maxLength={3} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
 </Field>
 <div>
 <label className="label mb-2 block">Partner Tier</label>
 <div className="flex items-center gap-2">
 <button type="button" onClick={() => setPartnerTier(!partnerTier)}
 className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${partnerTier ? 'text-accent-text' : 'text-fg-secondary'}`}>
 {partnerTier ? 'Yes' : 'No'}
 <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${partnerTier ? 'bg-success' : 'bg-border'}`}>
 <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${partnerTier ? 'translate-x-[18px]' : 'translate-x-0'}`} />
 </span>
 </button>
 {partnerTier && <select className="input"><option>Not available yet</option></select>}
 </div>
 </div>
 </div>
 <Field label="Labels">
 <input className="input" placeholder="Add labels…" disabled />
 <p className="mt-1 text-[11px] text-fg-muted">Not yet available in this app.</p>
 </Field>
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <div className="flex items-center gap-3">
 <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 rounded border-border" />
 <label className="text-small text-fg">Allow partner to receive notifications</label>
 </div>
 <div className="flex items-center gap-3">
 <input type="checkbox" checked={dynamicPayouts} onChange={(e) => setDynamicPayouts(e.target.checked)} className="h-4 w-4 rounded border-border" />
 <label className="text-small text-fg">Enable CPC/CPM Dynamic Payouts</label>
 </div>
 </div>
 <Field label="Traffic Source">
 <div className="flex items-center gap-3">
 <button type="button" onClick={() => setTrafficSourceEnabled(!trafficSourceEnabled)}
 className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${trafficSourceEnabled ? 'text-accent-text' : 'text-fg-secondary'}`}>
 {trafficSourceEnabled ? 'Yes' : 'No'}
 <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${trafficSourceEnabled ? 'bg-success' : 'bg-border'}`}>
 <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${trafficSourceEnabled ? 'translate-x-[18px]' : 'translate-x-0'}`} />
 </span>
 </button>
 {trafficSourceEnabled && (
 <input className="input flex-1" value={form.trafficSource} onChange={(e) => set('trafficSource', e.target.value)} placeholder="Push, Native, Social…" />
 )}
 </div>
 </Field>
 <Field label="Internal Notes">
 <textarea className="input min-h-[80px]" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Notes for internal use…" />
 </Field>
 <Field label="Set Macro Parameter Visibility">
 <Segmented options={['None', 'Custom', 'Full access']} value={macroVisibility} onChange={setMacroVisibility} />
 </Field>
 </div>
 )}

 {step === 1 && (
 <div className="space-y-4">
 <div className="flex items-center gap-3">
 <input type="checkbox" checked={addressEnabled} onChange={(e) => setAddressEnabled(e.target.checked)} className="h-4 w-4 rounded border-border" />
 <label className="text-small text-fg">Enable Address</label>
 </div>
 {addressEnabled && (
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <Field label="Billing Frequency">
 <select className="input" defaultValue="Weekly">
 {['Weekly', 'Bimonthly', 'Monthly'].map((f) => <option key={f}>{f}</option>)}
 </select>
 </Field>
 <Field label="Payout Terms *">
 <textarea className="input min-h-[80px]" required value={form.payoutTerms} onChange={(e) => set('payoutTerms', e.target.value)} placeholder="Net-30, minimum $50…" />
 </Field>
 </div>
 <div>
 <label className="label mb-2 block">Enable Payment Method</label>
 <div className="flex items-center gap-3">
 <button type="button" onClick={() => setPaymentEnabled(!paymentEnabled)}
 className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${paymentEnabled ? 'text-accent-text' : 'text-fg-secondary'}`}>
 {paymentEnabled ? 'Yes' : 'No'}
 <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${paymentEnabled ? 'bg-success' : 'bg-border'}`}>
 <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${paymentEnabled ? 'translate-x-[18px]' : 'translate-x-0'}`} />
 </span>
 </button>
 {paymentEnabled && <select className="input !w-auto" defaultValue="Wire">
 {['Wire', 'PayPal', 'ACH', 'Check'].map((m) => <option key={m}>{m}</option>)}
 </select>}
 </div>
 </div>
 {paymentEnabled && (
 <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-2">
 <Field label="Bank Name"><input className="input" /></Field>
 <Field label="Account Number"><input className="input" /></Field>
 <Field label="Tax ID / VAT or SSN"><input className="input" /></Field>
 </div>
 )}
 <p className="text-[11px] text-fg-muted">Bank details and Tax ID are not yet persisted to the database.</p>
 </div>
 )}

 {step === 3 && (
 <div className="space-y-4">
 <p className="text-small text-fg-secondary">Create a login for this partner to access their portal.</p>
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <Field label="First Name">
 <input className="input" value={form.contactFirstName} onChange={(e) => set('contactFirstName', e.target.value)} />
 </Field>
 <Field label="Last Name">
 <input className="input" value={form.contactLastName} onChange={(e) => set('contactLastName', e.target.value)} />
 </Field>
 </div>
 <Field label="Email *">
 <input type="email" className={fieldClass('contactEmail')} required value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
 {fieldError('contactEmail')}
 </Field>
 <p className="text-[11px] text-fg-muted">Portal user creation is handled separately from this form.</p>
 </div>
 )}

 <div className="flex justify-end gap-2 border-t border-border pt-4">
 <button type="button" className="btn-ghost" onClick={() => (step === 0 ? nav('/app/publishers') : setStep(step - 1))}>
 {step === 0 ? 'Cancel' : 'Back'}
 </button>
 <button type="submit" className="btn-primary" disabled={busy}>
 {busy ? <span className="inline-flex items-center gap-2"><Spinner /> Creating…</span> : step === STEPS.length - 1 ? 'Create Partner' : 'Next'}
 </button>
 </div>
 </form>
 </div>
 </>
 );
}
