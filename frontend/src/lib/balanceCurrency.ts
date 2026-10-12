/**
 * Partner (publisher) ledger balances, per currency — never added across currencies (no FX yet).
 *
 * Newer APIs send, next to the single `balance`, the balance's currency and its per-currency parts:
 *  - `POST /api/publishers/request-balances` rows: `{ publisherId, balance, currency, balances: [{ currency, balance }] }`
 *  - `GET /api/portal/publisher/earnings`: `{ balance, currency, balances, statement }`
 *  - `GET /api/portal/publisher/summary`: `{ …kpis, balance, balanceCurrency | currency, balances }`
 * `balance` is null when the approved balance spans several currencies. An older API sends only
 * `balance` (no currency) — callers then keep their existing display, but never add such amounts
 * to amounts in a known currency.
 *
 * Pure (imports only the formatters) — `node --test` exercises the real module
 * (lib/__tests__/balanceCurrency.test.ts).
 */
import { money } from './reportMath.ts';
import { addDecimal, BREAKDOWN_SEP, MIXED_LABEL, mixedTitle } from './reportCurrency.ts';

export interface BalancePart { currency: string; amount: string }

const DECIMAL = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

/** A decimal-string amount from an API value (string or finite number); null otherwise. */
function amountOf(v: unknown): string | null {
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  return DECIMAL.test(s) ? s : null;
}

function codeOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : null;
}

/** Parts added together per currency (exact decimals), ordered by currency code. */
export function sumPartsByCurrency(parts: readonly BalancePart[]): BalancePart[] {
  const acc = new Map<string, string>();
  for (const p of parts) acc.set(p.currency, acc.has(p.currency) ? addDecimal(acc.get(p.currency)!, p.amount) : p.amount);
  return [...acc.keys()].sort().map((currency) => ({ currency, amount: acc.get(currency)! }));
}

/**
 * The per-currency parts of one balance payload:
 *  - a non-empty `balances` list → its entries (normalised, same currency merged)
 *  - else `balance` + `currency` (or `balanceCurrency`) → that one part
 *  - else an empty `balances` list → [] (no balance at all)
 *  - else null — no currency information (older API); the caller must not add it to anything.
 */
export function balanceParts(src: unknown): BalancePart[] | null {
  if (!src || typeof src !== 'object') return null;
  const o = src as Record<string, unknown>;
  const list = Array.isArray(o['balances']) ? o['balances'] : null;
  if (list && list.length) {
    const parts: BalancePart[] = [];
    for (const e of list) {
      if (!e || typeof e !== 'object') return null;
      const r = e as Record<string, unknown>;
      const currency = codeOf(r['currency']);
      const amount = amountOf(r['balance'] ?? r['amount']);
      if (!currency || amount === null) return null; // malformed → treat as unknown, never guess
      parts.push({ currency, amount });
    }
    return sumPartsByCurrency(parts);
  }
  const currency = codeOf(o['currency']) ?? codeOf(o['balanceCurrency']);
  const amount = amountOf(o['balance']);
  if (currency && amount !== null) return [{ currency, amount }];
  return list ? [] : null;
}

/** "€30.25 · $13.00" — each part in its own currency, code order. */
export function formatParts(parts: readonly BalancePart[]): string {
  return parts.map((p) => money(Number(p.amount), p.currency)).join(BREAKDOWN_SEP);
}

export interface BalanceText { text: string; title?: string; muted: boolean }

/**
 * How a single balance tile shows a balance payload. Null when the payload carries no currency
 * information (older API) — the caller keeps its existing display of `balance`.
 *  - one currency → that amount in that currency
 *  - several → the per-currency amounts ("€30.25 · $13.00"), never a sum
 *  - none (empty `balances`) → zero in `zeroCurrency`
 *  - `balance` null without parts → "Mixed"
 */
export function balanceText(src: unknown, zeroCurrency = 'USD'): BalanceText | null {
  const parts = balanceParts(src);
  if (parts === null) {
    const o = (src && typeof src === 'object' ? src : {}) as Record<string, unknown>;
    return 'balance' in o && o['balance'] === null
      ? { text: MIXED_LABEL, title: 'Balance spans several currencies — not added together; no FX conversion yet', muted: true }
      : null;
  }
  if (parts.length === 0) return { text: money(0, zeroCurrency), muted: false };
  if (parts.length === 1) return { text: money(Number(parts[0]!.amount), parts[0]!.currency), muted: false };
  return { text: formatParts(parts), title: `Per currency — ${mixedTitle(parts.map((p) => p.currency))}`, muted: false };
}

/** One row of `POST /api/publishers/request-balances`. */
export interface RequestedBalance { publisherId: string; balance?: string | null; currency?: string | null; balances?: unknown }

/**
 * The toast for "Request Outstanding Balances": the total per currency (exact decimals, never
 * across currencies), a partner whose balance spans currencies shown with its own breakdown, and a
 * partner whose balance has no currency (older API) listed on its own — never in a total.
 */
export function requestedBalancesMessage(rows: readonly RequestedBalance[], nameOf: (publisherId: string) => string = (id) => id): string {
  const known: BalancePart[] = [];
  const mixed: string[] = [];
  const unknown: string[] = [];
  for (const r of rows) {
    const parts = balanceParts(r);
    if (parts === null) {
      const amt = amountOf(r.balance);
      unknown.push(`${nameOf(r.publisherId)} ${amt ?? '—'}`);
      continue;
    }
    known.push(...parts);
    if (parts.length > 1) mixed.push(`${nameOf(r.publisherId)}: ${formatParts(parts)}`);
  }
  const n = rows.length;
  let msg = `Recorded outstanding balance for ${n} partner${n === 1 ? '' : 's'}`;
  if (n > unknown.length) {
    const totals = sumPartsByCurrency(known);
    msg += totals.length ? ` (total ${formatParts(totals)})` : ' (no outstanding balance)';
  }
  msg += '.';
  if (mixed.length) msg += ` Several currencies — ${mixed.join('; ')}.`;
  if (unknown.length) msg += ` Currency not reported, not totalled — ${unknown.join('; ')}.`;
  return msg;
}
