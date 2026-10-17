/**
 * Price Per Product (Revenue › Base Revenue › "Price Per Product"). The advertiser's postback lists the order's
 * products, and each line is priced by the offer's product rule for its SKU, else for its category
 * (table offer_products), else by the offer's base rate per unit:
 *
 *   products=[{"sku":"A1","category":"shoes","price":"20.00","quantity":2}, …]   (JSON, query or POST body)
 *   — or one product: sku= (or product_id=) & category= & quantity= (qty=) & price= (unit_price=)
 *
 * A line's amount is price × quantity (or its `amount` / `total`, or — for a single product with no price —
 * the postback's sale amount). A rule is a fixed amount per unit or a percentage of the line's amount, for
 * the payout and the revenue separately. Only the authenticated S2S postback prices products — a browser-fired
 * pixel never does (the visitor could write any price). Pure.
 */
import { addMoney, normalizeMoney, percentOfMoney, scaleMoney } from '../money.js';

export interface ProductPrice {
  id: string;
  sku: string | null;
  category: string | null;
  payoutType: 'fixed' | 'percent';
  payoutValue: string | null;
  revenueType: 'fixed' | 'percent';
  revenueValue: string | null;
}

export interface ProductLine {
  sku: string | null;
  category: string | null;
  quantity: number;
  /** The line's total (price × quantity), null when not known. */
  amount: string | null;
}

export interface PricedLine extends ProductLine {
  /** The offer product rule that priced it; null = the offer's base rate. */
  productId: string | null;
  payout: string | null;
  revenue: string | null;
}

export interface ProductPricing {
  payout: string | null;
  revenue: string | null;
  /** Units sold across the lines. */
  units: number;
  /** The lines' total when every line has an amount (the sale amount for CPS pricing), else null. */
  total: string | null;
  lines: PricedLine[];
}

export const MAX_PRODUCT_LINES = 200;
const MAX_QTY = 100_000;

const str = (v: unknown): string | null => {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s === 'number' && Number.isFinite(s)) return String(s);
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, 200) : null;
};
const money = (v: unknown): string | null => {
  const s = str(v);
  if (s == null) return null;
  try {
    const n = normalizeMoney(s);
    return n.startsWith('-') ? null : n;
  } catch {
    return null;
  }
};
const qty = (v: unknown): number => {
  const s = str(v);
  const n = s != null && /^\d+$/.test(s) ? Number(s) : 1;
  return Math.min(Math.max(n, 1), MAX_QTY);
};
const first = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return undefined;
};

function lineOf(o: Record<string, unknown>, fallbackAmount: string | null): ProductLine | null {
  const sku = str(first(o, ['sku', 'product_id', 'id', 'item_id']));
  const category = str(first(o, ['category', 'cat', 'product_category']));
  if (!sku && !category) return null;
  const quantity = qty(first(o, ['quantity', 'qty', 'q']));
  const price = money(first(o, ['price', 'unit_price', 'p']));
  const amount = money(first(o, ['amount', 'total', 'line_total'])) ?? (price != null ? scaleMoney(price, quantity) : money(fallbackAmount));
  return { sku, category, quantity, amount };
}

/** The product lines of a conversion request (query + body params), or null when it lists none. */
export function parseProductLines(params: Record<string, unknown>, saleAmount: string | null): ProductLine[] | null {
  let raw: unknown = params['products'];
  if (Array.isArray(raw) && raw.length && typeof raw[0] === 'string') raw = raw[0]; // ?products=… repeated
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (Array.isArray(raw)) {
    const lines = raw.slice(0, MAX_PRODUCT_LINES)
      .map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? lineOf(x as Record<string, unknown>, null) : null))
      .filter((l): l is ProductLine => l != null);
    return lines.length ? lines : null;
  }
  // One product as plain parameters; with no price its amount is the postback's sale amount.
  const single = lineOf({
    sku: first(params, ['sku', 'product_id']), category: first(params, ['category', 'product_category']),
    quantity: first(params, ['quantity', 'qty']), price: first(params, ['price', 'unit_price']),
  }, saleAmount);
  return single ? [single] : null;
}

const lower = (s: string | null) => s?.toLowerCase() ?? null;

function ruleFor(line: ProductLine, rules: ProductPrice[]): ProductPrice | null {
  const sku = lower(line.sku);
  const cat = lower(line.category);
  return (sku ? rules.find((r) => lower(r.sku) === sku) : undefined)
    ?? (cat ? rules.find((r) => r.sku == null && lower(r.category) === cat) : undefined)
    ?? null;
}

const sideOf = (type: 'fixed' | 'percent', value: string, line: ProductLine): string =>
  type === 'percent' ? (line.amount != null ? percentOfMoney(line.amount, value) : '0.0000') : scaleMoney(value, line.quantity);

/**
 * Prices the lines. `base` is what an unmatched line falls back to: the offer's payout per unit, and its
 * revenue per its Revenue Type (fixed per unit, a percentage of the line's amount, or both for Mixed).
 */
export function priceProducts(
  lines: ProductLine[], rules: ProductPrice[],
  base: { payout: string | null; revenue: string | null; revenueType: 'fixed' | 'percentage' | 'mixed'; revenuePct: number | null },
): ProductPricing {
  let payout: string | null = null;
  let revenue: string | null = null;
  let total: string | null = '0.0000';
  let units = 0;
  const add = (sum: string | null, v: string | null) => (v == null ? sum : addMoney(sum ?? '0', v));
  const priced = lines.map((line): PricedLine => {
    const rule = ruleFor(line, rules);
    const p = rule?.payoutValue != null ? sideOf(rule.payoutType, rule.payoutValue, line)
      : base.payout != null ? scaleMoney(base.payout, line.quantity) : null;
    let r: string | null;
    if (rule?.revenueValue != null) r = sideOf(rule.revenueType, rule.revenueValue, line);
    else {
      const fixed = base.revenueType !== 'percentage' && base.revenue != null ? scaleMoney(base.revenue, line.quantity) : null;
      const share = base.revenueType !== 'fixed' && base.revenuePct != null && line.amount != null ? percentOfMoney(line.amount, base.revenuePct) : null;
      r = fixed != null && share != null ? addMoney(fixed, share) : fixed ?? share;
    }
    payout = add(payout, p);
    revenue = add(revenue, r);
    units += line.quantity;
    total = total != null && line.amount != null ? addMoney(total, line.amount) : null;
    return { ...line, productId: rule?.id ?? null, payout: p, revenue: r };
  });
  return { payout, revenue, units, total, lines: priced };
}
