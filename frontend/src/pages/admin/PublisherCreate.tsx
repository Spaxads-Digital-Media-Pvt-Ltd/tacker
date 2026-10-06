/**
 * Add Partner (Everflow-style 4-step wizard: General/Address/Billing/User).
 * POSTs to /api/publishers on the final step. Every field the backend stores is wired (same
 * sources/options as Partner Edit); the few preferences with no backing field are labelled as such.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useMutation, useQuery } from '../../lib/useApi';
import { PageHeader, Field, Segmented, Spinner } from '../../shared-components/primitives/ui';
import { useConfirm } from '../../shared-components/primitives/confirm';
import { Stepper } from '../../shared-components/panels/Stepper';
import { LabelsInput } from '../../shared-components/panels/LabelsEditor';
import type { DashboardUser, Publisher } from '../../types';

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
 tier: string;
 partnerManagerId: string;
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
 tier: partnerTier ? form.tier.trim() || undefined : undefined,
 partnerManagerId: form.partnerManagerId || undefined,
 accountExecutiveId: accountExec ? form.accountExecutiveId || undefined : undefined,
 referredById: referredBy ? form.referredById || undefined : undefined,
 billingFrequency: form.billingFrequency || undefined,
 paymentMethod: form.paymentMethod || undefined,
 taxId: form.taxId.trim() || undefined,
 notes: form.notes || undefined,
 trafficSource: trafficSourceEnabled ? form.trafficSource || undefined : undefined,
 };
 const res = await run(body);
 if (!res) return;
 // The partner exists now — a failed label must not strand the user on the wizard (a resubmit
 // would create a duplicate partner), so report it and carry on to the new partner.
 const failedLabels: string[] = [];
 for (const name of labels) {
 try { await api.post(`/api/publishers/${res.id}/tags`, { name }); } catch { failedLabels.push(name); }
 }
 if (failedLabels.length) await confirm({ title: 'Partner created with warnings', message: `Partner created, but these labels could not be added: ${failedLabels.join(', ')}`, cancelLabel: null });
 nav(`/app/publishers/${res.id}`);
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
 <label className="label">Status *</label>
 <Segmented options={STATUSES} value={form.status} onChange={(v) => set('status', v)} dots={STATUS_DOT} />
 </div>
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <Field label="Partner Manager">
 <select className="input" value={form.partnerManagerId} onChange={(e) => set('partnerManagerId', e.target.value)}>
 <option value="">— Select —</option>
 {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
 </select>
 </Field>
 <div>
 <label className="label">Account Executive</label>
 <div className="flex items-center gap-2">
 <button type="button" onClick={() => setAccountExec(!accountExec)}
 className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${accountExec ? 'text-accent-text' : 'text-fg-secondary'}`}>
 {accountExec ? 'Yes' : 'No'}
 <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${accountExec ? 'bg-success' : 'bg-border'}`}>
 <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${accountExec ? 'translate-x-[18px]' : 'translate-x-0'}`} />
 </span>
 </button>
 {accountExec && <select className="input" value={form.accountExecutiveId} onChange={(e) => set('accountExecutiveId', e.target.value)}>
 <option value="">— Select —</option>
 {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
 </select>}
 </div>
 </div>
 </div>
 <div>
 <label className="label">Referred By</label>
 <div className="flex items-center gap-2">
 <button type="button" onClick={() => setReferredBy(!referredBy)}
 className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${referredBy ? 'text-accent-text' : 'text-fg-secondary'}`}>
 {referredBy ? 'Yes' : 'No'}
 <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${referredBy ? 'bg-success' : 'bg-border'}`}>
 <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${referredBy ? 'translate-x-[18px]' : 'translate-x-0'}`} />
 </span>
 </button>
 {referredBy && <select className="input" value={form.referredById} onChange={(e) => set('referredById', e.target.value)}>
 <option value="">— Select —</option>
 {(publishers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
 </select>}
 </div>
 </div>
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <div>
 <label className="label">Partner Tier</label>
 <div className="flex items-center gap-2">
 <button type="button" onClick={() => setPartnerTier(!partnerTier)}
 className={`inline-flex items-center gap-2 rounded-[var(--radius)] border border-border px-3 py-1.5 text-small font-medium ${partnerTier ? 'text-accent-text' : 'text-fg-secondary'}`}>
 {partnerTier ? 'Yes' : 'No'}
 <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${partnerTier ? 'bg-success' : 'bg-border'}`}>
 <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${partnerTier ? 'translate-x-[18px]' : 'translate-x-0'}`} />
 </span>
 </button>
 {partnerTier && <input className="input" value={form.tier} onChange={(e) => set('tier', e.target.value)} placeholder="e.g. Gold, Silver, Bronze" />}
 </div>
 </div>
 </div>
 <LabelsInput value={labels} onChange={setLabels} />
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
 <p className="text-[11px] text-fg-muted">Notification, dynamic-payout and macro-visibility preferences are not stored yet.</p>
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
 <select className="input" value={form.billingFrequency} onChange={(e) => set('billingFrequency', e.target.value)}>
 <option value="">—</option>
 {['Weekly', 'Bi-Weekly', 'Monthly', 'Net 15', 'Net 30'].map((f) => <option key={f} value={f}>{f}</option>)}
 </select>
 </Field>
 <Field label="Payout Terms *">
 <textarea className="input min-h-[80px]" required value={form.payoutTerms} onChange={(e) => set('payoutTerms', e.target.value)} placeholder="Net-30, minimum $50…" />
 </Field>
 </div>
 <Field label="Payment Method">
 <select className="input !w-auto" value={form.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)}>
 <option value="">—</option>
 {['Wire', 'Paypal', 'Webmoney', 'Direct Deposit', 'None'].map((m) => <option key={m} value={m}>{m}</option>)}
 </select>
 </Field>
 {form.paymentMethod && form.paymentMethod !== 'None' && (
 <div className="grid grid-cols-1 gap-4 rounded-card border border-border bg-page p-4 sm:grid-cols-2">
 <Field label="Bank Name"><input className="input" /></Field>
 <Field label="Account Number"><input className="input" /></Field>
 <p className="text-[11px] text-fg-muted sm:col-span-2">Bank details are not stored yet.</p>
 </div>
 )}
 <Field label="Tax ID / VAT or SSN"><input className="input" value={form.taxId} onChange={(e) => set('taxId', e.target.value)} /></Field>
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
