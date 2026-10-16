/**
 * Platform billing settings (Super Admin › Settings), one row in platform_settings (key 'billing'),
 * merged over the defaults below — so a fresh platform bills sensibly before anyone saves them.
 *
 * - invoicePrefix: invoice numbers read `<prefix>-<year>-<00042>`.
 * - dueDays: an invoice is due this many days after it is issued.
 * - graceDays: unpaid this many days after its due date → the network is suspended (autoSuspend).
 * - taxRate: percent added to every invoice, as text (money and rates are never floats).
 * - seller / paymentInstructions: printed on invoices and the tenant's Billing page (no payment gateway
 *   yet: the instructions say how to pay — bank transfer, UPI…; a Super Admin marks the invoice paid).
 */
import { query } from '../db/pool.js';

export interface BillingSettings {
  invoicePrefix: string;
  dueDays: number;
  graceDays: number;
  taxRate: string;
  autoSuspend: boolean;
  seller: { name: string; address: string; taxId: string; email: string };
  paymentInstructions: string;
}

export const DEFAULT_BILLING: BillingSettings = {
  invoicePrefix: 'INV',
  dueDays: 7,
  graceDays: 7,
  taxRate: '0',
  autoSuspend: true,
  seller: { name: '', address: '', taxId: '', email: '' },
  paymentInstructions: '',
};

export async function billingSettings(): Promise<BillingSettings> {
  const row = (await query<{ value: Partial<BillingSettings> }>(`SELECT value FROM platform_settings WHERE key = 'billing'`)).rows[0];
  const v = row?.value ?? {};
  return { ...DEFAULT_BILLING, ...v, seller: { ...DEFAULT_BILLING.seller, ...(v.seller ?? {}) } };
}

export async function saveBillingSettings(value: BillingSettings, platformAdminId: string | null): Promise<BillingSettings> {
  await query(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('billing', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(value), platformAdminId]);
  return billingSettings();
}
