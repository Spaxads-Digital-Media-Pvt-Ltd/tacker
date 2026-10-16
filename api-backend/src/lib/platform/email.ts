/**
 * The platform's email settings (Super Admin › Settings › Email; platform_settings 'email'): its SMTP — the
 * password stored encrypted (secret-box), never returned — and which notifications it sends. Until the SMTP is
 * set up, notifications are skipped (lib/platform/notify.ts).
 */
import { query } from '../db/pool.js';
import { encryptSecret } from '../crypto/secret-box.js';

export const NOTIFICATIONS = [
  { key: 'ticketCreated', label: 'A new support ticket — to its agent (or the support team)' },
  { key: 'customerReply', label: 'A customer answered a ticket — to its agent' },
  { key: 'staffReply', label: 'Support answered — to the customer who asked' },
  { key: 'leadInbound', label: 'A demo request — to the salesperson it went to' },
  { key: 'taskAssigned', label: 'A task given to someone — to them' },
  { key: 'invoiceIssued', label: 'A new invoice — to the network’s owner' },
  { key: 'invoiceOverdue', label: 'An invoice is overdue — to the network’s owner' },
  { key: 'networkSuspended', label: 'A network suspended for an unpaid invoice — to its owner' },
] as const;
export type NotificationKey = (typeof NOTIFICATIONS)[number]['key'];

export interface PlatformEmailSettings {
  host: string; port: number; secure: boolean; username: string; fromEmail: string; fromName: string;
  notify: Record<NotificationKey, boolean>;
}
interface Stored extends Partial<PlatformEmailSettings> { password?: string }

const DEFAULTS: PlatformEmailSettings = {
  host: '', port: 587, secure: false, username: '', fromEmail: '', fromName: '',
  notify: Object.fromEntries(NOTIFICATIONS.map((n) => [n.key, true])) as Record<NotificationKey, boolean>,
};

async function stored(): Promise<Stored> {
  return (await query<{ value: Stored }>(`SELECT value FROM platform_settings WHERE key = 'email'`)).rows[0]?.value ?? {};
}

/** The settings as the console shows them: no password — only whether one is set. */
export async function platformEmailSettings(): Promise<PlatformEmailSettings & { hasPassword: boolean }> {
  const s = await stored();
  const { password, ...rest } = s;
  return { ...DEFAULTS, ...rest, notify: { ...DEFAULTS.notify, ...(s.notify ?? {}) }, hasPassword: Boolean(password) };
}

/** Save; `password` undefined / '' keeps the stored one, null clears it. */
export async function savePlatformEmailSettings(v: PlatformEmailSettings & { password?: string | null }, by: string | null): Promise<PlatformEmailSettings & { hasPassword: boolean }> {
  const current = await stored();
  const { password, ...rest } = v;
  const next: Stored = { ...rest, password: password === null ? undefined : password ? encryptSecret(password) : current.password };
  await query(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('email', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(next), by]);
  return platformEmailSettings();
}

/** Is this notification on (the SMTP being set up is checked when sending)? */
export async function notificationOn(key: NotificationKey): Promise<boolean> {
  return (await platformEmailSettings()).notify[key] !== false;
}
