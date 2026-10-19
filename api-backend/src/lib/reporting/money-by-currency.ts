/**
 * Money split by currency (`moneyByCurrency` / the `money_by_currency` metric). Money is never summed
 * or compared across currencies (no FX): each currency keeps its own payout / revenue / margin.
 *
 * `mbcJsonSql` is the ONE Postgres fragment that folds per-(group, currency) sums — columns
 * `<alias>.cur`, `<alias>.p` (payout), `<alias>.r` (revenue) — into a jsonb object
 * `{ [currency]: { payout?, revenue?, margin? } }` with numeric(14,4) text values; field names come
 * only from MONEY_FIELDS, so nothing caller-supplied reaches the SQL.
 */
import { addMoney } from '../money.js';
import { MONEY_FIELDS, type MoneyByCurrency, type MoneyField } from './types.js';

// round(x, 4) rather than ::numeric(14,4): these are SUMs, which can exceed the 10 integer digits a
// single amount column holds (the cast overflowed with a 500) — same 4dp text otherwise (F-22).
const FIELD_SQL: Record<MoneyField, (a: string) => string> = {
  payout: (a) => `'payout', round(${a}.p, 4)::text`,
  revenue: (a) => `'revenue', round(${a}.r, 4)::text`,
  margin: (a) => `'margin', round(${a}.r - ${a}.p, 4)::text`,
};

/** jsonb_object_agg over `<alias>.cur` → only the given money fields (all three by default). */
export function mbcJsonSql(alias: string, fields: readonly MoneyField[] = MONEY_FIELDS): string {
  const parts = MONEY_FIELDS.filter((f) => fields.includes(f)).map((f) => FIELD_SQL[f](alias));
  return `jsonb_object_agg(${alias}.cur, jsonb_build_object(${parts.join(', ')}))`;
}

/** Per-currency, per-field exact decimal sum of several MoneyByCurrency objects (keys sorted). */
export function mergeMoneyByCurrency(list: readonly MoneyByCurrency[]): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const m of list) {
    for (const [cur, v] of Object.entries(m ?? {})) {
      const t = (out[cur] ??= {});
      for (const f of MONEY_FIELDS) {
        const x = v[f];
        if (x != null) t[f] = t[f] == null ? addMoney('0', x) : addMoney(t[f]!, x);
      }
    }
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]!]));
}
