/**
 * What the platform emails (Super Admin › Settings › Email): tickets (new → the agent, answered → the
 * customer, a customer reply → the agent), a demo request → the salesperson, a task → its assignee, and the
 * network owner's invoice, overdue invoice and suspension. Each is skipped when its toggle is off or the
 * platform's SMTP isn't set up; sent through the email queue (retried, logged — Settings › Email › log).
 * Never throws: a notification never breaks what triggered it. Every value in an email is escaped.
 */
import { query } from '../db/pool.js';
import { logger } from '../logger.js';
import { BRAND } from '../../config/branding.js';
import { appUrl } from '../app-url.js';
import { escapeHtml as e } from '../email/transactional.js';
import { notifyStaffInApp } from './staff-security.js';
import { enqueuePlatformEmails } from '../email/outbox.js';
import { platformSmtpConfigError } from '../mailer.js';
import { notificationOn, type NotificationKey } from './email.js';

/** A plain email: a heading, paragraphs (already escaped), a button. */
export function layout(p: { heading: string; paragraphs: string[]; button?: { label: string; url: string }; footer?: string }): string {
  return [
    `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">`,
    `<p style="font-size:13px;color:#64748b;margin:0 0 16px">${e(BRAND.name)}</p>`,
    `<h2 style="font-size:18px;margin:0 0 12px">${e(p.heading)}</h2>`,
    ...p.paragraphs.map((x) => `<p style="font-size:14px;line-height:1.55;margin:0 0 12px">${x}</p>`),
    p.button ? `<p style="margin:20px 0"><a href="${e(p.button.url)}" style="background:#0d9488;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px">${e(p.button.label)}</a></p>` : '',
    `<p style="font-size:12px;color:#94a3b8;margin-top:24px">${e(p.footer ?? `Sent by ${BRAND.name}.`)}</p>`,
    `</div>`,
  ].join('\n');
}

const quote = (body: string) => `<span style="display:block;border-left:3px solid #cbd5e1;padding-left:10px;color:#334155;white-space:pre-wrap">${e(body.length > 2000 ? `${body.slice(0, 2000)}…` : body)}</span>`;

/** A notification never throws: its failure is logged, not passed to what triggered it. */
const safely = <A extends unknown[]>(name: string, fn: (...a: A) => Promise<void>) => async (...a: A): Promise<void> => {
  try { await fn(...a); } catch (err) { logger.warn({ err, name }, 'platform notification failed'); }
};

async function send(key: NotificationKey, event: string, to: (string | null | undefined)[], mail: { subject: string; html: string }, aboutNetworkId?: string | null): Promise<void> {
  try {
    const recipients = to.filter((x): x is string => !!x);
    if (!recipients.length || !(await notificationOn(key)) || (await platformSmtpConfigError())) return;
    await enqueuePlatformEmails(event, recipients, mail, { aboutNetworkId });
  } catch (err) {
    logger.warn({ err, event }, 'platform notification failed');
  }
}

/** The active members who hold `section` at full (when nobody is assigned). */
async function sectionTeam(section: string): Promise<string[]> {
  return (await query<{ email: string }>(
    `SELECT pa.email FROM platform_admins pa JOIN platform_roles r ON r.id = pa.role_id
      WHERE pa.status = 'active' AND r.permissions->>$1 = 'full' AND r.key <> 'owner' LIMIT 20`, [section])).rows.map((r) => r.email);
}

const ownerEmail = async (networkId: string) => (await query<{ email: string }>(
  `SELECT email FROM users WHERE network_id = $1 AND role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1`, [networkId])).rows[0]?.email ?? null;

// ---------- Support ----------
async function notifyTicketCreatedImpl(ticketId: string): Promise<void> {
  const t = (await query<{ number: string; subject: string; priority: string; network_id: string; network_name: string; assignee_email: string | null; body: string | null }>(
    `SELECT t.number::text, t.subject, t.priority, t.network_id, n.name AS network_name, a.email AS assignee_email,
            (SELECT body FROM support_messages m WHERE m.ticket_id = t.id ORDER BY created_at LIMIT 1) AS body
       FROM support_tickets t JOIN networks n ON n.id = t.network_id LEFT JOIN platform_admins a ON a.id = t.assignee_id WHERE t.id = $1`, [ticketId])).rows[0];
  if (!t) return;
  const to = t.assignee_email ? [t.assignee_email] : await sectionTeam('support');
  await notifyStaffInApp({ emails: to }, { kind: 'ticket', title: `New ticket from ${t.network_name}: ${t.subject}`, link: `/admin/support/${ticketId}` });
  await send('ticketCreated', 'support.ticket_created', to, {
    subject: `[#${t.number}] ${t.network_name}: ${t.subject}`,
    html: layout({
      heading: `New ${t.priority === 'normal' ? '' : `${t.priority} `}ticket from ${t.network_name}`,
      paragraphs: [`<strong>${e(t.subject)}</strong>`, quote(t.body ?? '')],
      button: { label: 'Open the ticket', url: appUrl(`/admin/support/${ticketId}`) },
    }),
  }, t.network_id);
}

async function notifyCustomerReplyImpl(ticketId: string, body: string): Promise<void> {
  const t = (await query<{ number: string; subject: string; network_id: string; network_name: string; assignee_email: string | null }>(
    `SELECT t.number::text, t.subject, t.network_id, n.name AS network_name, a.email AS assignee_email
       FROM support_tickets t JOIN networks n ON n.id = t.network_id LEFT JOIN platform_admins a ON a.id = t.assignee_id WHERE t.id = $1`, [ticketId])).rows[0];
  if (!t) return;
  const replyTo = t.assignee_email ? [t.assignee_email] : await sectionTeam('support');
  await notifyStaffInApp({ emails: replyTo }, { kind: 'ticket_reply', title: `${t.network_name} replied on #${t.number}`, body: body.slice(0, 200), link: `/admin/support/${ticketId}` });
  await send('customerReply', 'support.customer_reply', replyTo, {
    subject: `Re: [#${t.number}] ${t.subject}`,
    html: layout({ heading: `${t.network_name} replied`, paragraphs: [quote(body)], button: { label: 'Answer', url: appUrl(`/admin/support/${ticketId}`) } }),
  }, t.network_id);
}

async function notifyStaffReplyImpl(ticketId: string, body: string, agentName: string | null): Promise<void> {
  const t = (await query<{ number: string; subject: string; network_id: string; requester_email: string | null; requester_name: string | null }>(
    `SELECT number::text, subject, network_id, requester_email, requester_name FROM support_tickets WHERE id = $1`, [ticketId])).rows[0];
  if (!t?.requester_email) return;
  await send('staffReply', 'support.staff_reply', [t.requester_email], {
    subject: `Re: [#${t.number}] ${t.subject}`,
    html: layout({
      heading: `${agentName ?? 'Support'} answered your ticket`,
      paragraphs: [`Hello ${e(t.requester_name ?? '')},`, quote(body), 'Reply in your dashboard (Help › Contact Support).'],
      button: { label: 'See the ticket', url: appUrl(`/app/support/${ticketId}`) },
    }),
  }, t.network_id);
}

// ---------- Sales / tasks ----------
async function notifyLeadInboundImpl(leadId: string): Promise<void> {
  const l = (await query<{ company: string; contact_name: string | null; email: string | null; message: string | null; owner_email: string | null }>(
    `SELECT l.company, l.contact_name, l.email, l.message, o.email AS owner_email FROM sales_leads l LEFT JOIN platform_admins o ON o.id = l.owner_id WHERE l.id = $1`, [leadId])).rows[0];
  if (!l) return;
  const leadTo = l.owner_email ? [l.owner_email] : await sectionTeam('sales');
  await notifyStaffInApp({ emails: leadTo }, { kind: 'lead', title: `${l.company} asked for a demo`, link: `/admin/sales/leads/${leadId}` });
  await send('leadInbound', 'sales.lead_inbound', leadTo, {
    subject: `New demo request: ${l.company}`,
    html: layout({
      heading: `${l.company} asked for a demo`,
      paragraphs: [`${e(l.contact_name ?? '')} · ${e(l.email ?? '')}`, l.message ? quote(l.message) : ''],
      button: { label: 'Open the lead', url: appUrl(`/admin/sales/leads/${leadId}`) },
    }),
  });
}

async function notifyQuoteRespondedImpl(quoteId: string): Promise<void> {
  const q = (await query<{ number: string; status: string; responder_name: string | null; decline_reason: string | null; lead_id: string; company: string; owner_email: string | null }>(
    `SELECT q.number::text AS number, q.status, q.responder_name, q.decline_reason, l.id AS lead_id, l.company, o.email AS owner_email
       FROM sales_quotes q JOIN sales_leads l ON l.id = q.lead_id LEFT JOIN platform_admins o ON o.id = l.owner_id WHERE q.id = $1`, [quoteId])).rows[0];
  if (!q) return;
  const to = q.owner_email ? [q.owner_email] : await sectionTeam('sales');
  const verb = q.status === 'accepted' ? 'accepted' : 'declined';
  const title = `${q.company} ${verb} quote Q-${q.number}`;
  await notifyStaffInApp({ emails: to }, { kind: 'quote', title, body: q.decline_reason ?? (q.responder_name ? `By ${q.responder_name}` : null), link: `/admin/sales/leads/${q.lead_id}` });
  await send('quoteResponded', `sales.quote_${verb}`, to, {
    subject: title,
    html: layout({
      heading: title,
      paragraphs: [q.responder_name ? `${verb === 'accepted' ? 'Accepted' : 'Declined'} by ${e(q.responder_name)}.` : '', q.decline_reason ? quote(q.decline_reason) : ''],
      button: { label: 'Open the lead', url: appUrl(`/admin/sales/leads/${q.lead_id}`) },
    }),
  });
}

async function notifyTaskAssignedImpl(taskId: string, byName: string | null): Promise<void> {
  const t = (await query<{ title: string; due_at: Date | null; assignee_email: string | null; notes: string | null }>(
    `SELECT t.title, t.due_at, a.email AS assignee_email, t.notes FROM platform_tasks t LEFT JOIN platform_admins a ON a.id = t.assignee_id WHERE t.id = $1`, [taskId])).rows[0];
  if (!t?.assignee_email) return;
  await notifyStaffInApp({ emails: [t.assignee_email] }, { kind: 'task', title: `${byName ?? 'Someone'} gave you a task: ${t.title}`, link: '/admin/tasks' });
  await send('taskAssigned', 'tasks.assigned', [t.assignee_email], {
    subject: `New task: ${t.title}`,
    html: layout({
      heading: `${byName ?? 'Someone'} gave you a task`,
      paragraphs: [`<strong>${e(t.title)}</strong>${t.due_at ? ` — due ${e(t.due_at.toISOString().slice(0, 16).replace('T', ' '))} UTC` : ''}`, t.notes ? quote(t.notes) : ''],
      button: { label: 'Your tasks', url: appUrl('/admin/tasks') },
    }),
  });
}

// ---------- Billing (to the network's owner) ----------
async function notifyInvoiceIssuedImpl(invoiceId: string): Promise<void> {
  const i = (await query<{ number: string; network_id: string; total: string; currency: string; due_at: Date; status: string; name: string }>(
    `SELECT number, network_id, total::text, currency, due_at, status, bill_to->>'name' AS name FROM platform_invoices WHERE id = $1`, [invoiceId])).rows[0];
  if (!i || i.status !== 'open') return;
  await send('invoiceIssued', 'billing.invoice_issued', [await ownerEmail(i.network_id)], {
    subject: `Invoice ${i.number} — ${i.currency} ${i.total}, due ${i.due_at.toISOString().slice(0, 10)}`,
    html: layout({
      heading: `A new invoice for ${i.name}`,
      paragraphs: [`Invoice <strong>${e(i.number)}</strong> for <strong>${e(i.currency)} ${e(i.total)}</strong> is due on ${e(i.due_at.toISOString().slice(0, 10))}.`,
        'You can see it, and how to pay, under Settings › Billing.'],
      button: { label: 'View the invoice', url: appUrl(`/app/billing/invoices/${invoiceId}`) },
    }),
  }, i.network_id);
}

async function notifyInvoiceOverdueImpl(networkId: string): Promise<void> {
  const i = (await query<{ id: string; number: string; total: string; currency: string; suspend_at: Date }>(
    `SELECT id, number, total::text, currency, suspend_at FROM platform_invoices WHERE network_id = $1 AND status = 'open' AND due_at <= now() ORDER BY due_at LIMIT 1`, [networkId])).rows[0];
  if (!i) return;
  await send('invoiceOverdue', 'billing.invoice_overdue', [await ownerEmail(networkId)], {
    subject: `Overdue: invoice ${i.number} (${i.currency} ${i.total})`,
    html: layout({
      heading: 'An invoice is overdue',
      paragraphs: [`Invoice <strong>${e(i.number)}</strong> (${e(i.currency)} ${e(i.total)}) is past its due date. Please pay it by <strong>${e(i.suspend_at.toISOString().slice(0, 10))}</strong> to keep tracking, your dashboard and the API running.`],
      button: { label: 'Pay the invoice', url: appUrl(`/app/billing/invoices/${i.id}`) },
    }),
  }, networkId);
}

async function notifyNetworkSuspendedImpl(networkId: string, invoiceNumbers: string[]): Promise<void> {
  await send('networkSuspended', 'billing.network_suspended', [await ownerEmail(networkId)], {
    subject: 'Your network is suspended for an unpaid invoice',
    html: layout({
      heading: 'Your network is suspended',
      paragraphs: [`Tracking, your dashboard, the portals and the API are off because ${invoiceNumbers.length > 1 ? 'invoices' : 'invoice'} <strong>${e(invoiceNumbers.join(', '))}</strong> ${invoiceNumbers.length > 1 ? 'are' : 'is'} unpaid.`,
        'It comes back as soon as the payment is recorded — reply to this email or contact the platform team.'],
    }),
  }, networkId);
}

export const notifyTicketCreated = safely('notifyTicketCreated', notifyTicketCreatedImpl);
export const notifyCustomerReply = safely('notifyCustomerReply', notifyCustomerReplyImpl);
export const notifyStaffReply = safely('notifyStaffReply', notifyStaffReplyImpl);
export const notifyLeadInbound = safely('notifyLeadInbound', notifyLeadInboundImpl);
export const notifyTaskAssigned = safely('notifyTaskAssigned', notifyTaskAssignedImpl);
export const notifyQuoteResponded = safely('notifyQuoteResponded', notifyQuoteRespondedImpl);
export const notifyInvoiceIssued = safely('notifyInvoiceIssued', notifyInvoiceIssuedImpl);
export const notifyInvoiceOverdue = safely('notifyInvoiceOverdue', notifyInvoiceOverdueImpl);
export const notifyNetworkSuspended = safely('notifyNetworkSuspended', notifyNetworkSuspendedImpl);
