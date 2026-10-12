/**
 * Money cells for the report pages, in the row's own currency (lib/reportCurrency.ts). A row whose
 * conversions mix currencies shows a muted "Mixed" — explained on hover, with the per-currency
 * amounts when the API sent a breakdown — instead of a number, because its total would add EUR to USD.
 */
import { pct } from '../../lib/reportMath';
import {
  MIXED_LABEL, mixedTitle, moneyText, moneyFilterNote, SORTED_WITHIN_CURRENCY_NOTE,
  type MoneyByCurrency, type MoneyField, type RowCurrency,
} from '../../lib/reportCurrency';

export function MixedMoney({ currencies, title }: { currencies: readonly string[]; title?: string }) {
  return <span className="text-fg-muted" title={title ?? mixedTitle(currencies)}>{MIXED_LABEL}</span>;
}

/**
 * A money amount (payout, revenue, profit, CPC/CPA/EPC/RPC/RPA…) in the row's currency, or "Mixed".
 * With a `breakdown` of `field` (newer API), a mixed cell keeps "Mixed" but lists the per-currency
 * amounts in its tooltip — or shows them inline when `roomy` (totals rows).
 */
export function Money({ value, rc, breakdown, field, roomy }: {
  value: number; rc: RowCurrency; breakdown?: MoneyByCurrency | null; field?: MoneyField; roomy?: boolean;
}) {
  const t = moneyText(value, rc, { breakdown, field, roomy });
  return t.muted || t.title ? <span className={t.muted ? 'text-fg-muted' : undefined} title={t.title}>{t.text}</span> : <>{t.text}</>;
}

/** A ratio of two money amounts (margin %) — unavailable ("Mixed") on a mixed-currency row too. */
export function MoneyPct({ value, rc }: { value: number; rc: RowCurrency }) {
  return rc.kind === 'mixed' ? <MixedMoney currencies={rc.currencies} /> : <>{pct(value)}</>;
}

/**
 * Small notes beside a report table's title: the rows are sorted by a money column within each
 * currency (no FX), and/or a Payout/Revenue metric filter is set but not applied because the loaded
 * rows span several currencies (a threshold has no currency). Renders nothing when neither applies.
 */
export function CurrencyNotes({ sortedWithin, moneyFilterBlockedBy, moneyFilterActive }: {
  sortedWithin?: boolean; moneyFilterBlockedBy?: readonly string[] | null; moneyFilterActive?: boolean;
}) {
  const filterNotApplied = !!moneyFilterActive && !!moneyFilterBlockedBy;
  if (!sortedWithin && !filterNotApplied) return null;
  return (
    <>
      {sortedWithin && <span className="text-tiny text-fg-muted" title="Money in different currencies is never compared — each currency's rows are sorted on their own; rows mixing currencies come last.">{SORTED_WITHIN_CURRENCY_NOTE}</span>}
      {filterNotApplied && (
        <span className="rounded-full border border-warning bg-warning-bg px-2.5 py-0.5 text-tiny text-warning-text" role="status"
          title={`${moneyFilterNote(moneyFilterBlockedBy!)}. Payout/Revenue filters are not applied; the other metric filters still are.`}>
          Payout/Revenue filter not applied — results span {moneyFilterBlockedBy!.join(', ')}
        </span>
      )}
    </>
  );
}
