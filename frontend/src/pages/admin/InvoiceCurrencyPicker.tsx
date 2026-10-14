/**
 * One invoice per currency (O4): what the account earned (partners) or was billed (advertisers) in
 * each currency over the period (GET /api/{partner|advertiser}-invoices/preview), to pick the
 * invoice's currency. A currency that already has an invoice overlapping the period can't be picked;
 * nothing is ever converted between currencies.
 */
import { useEffect } from 'react';
import { useQuery } from '../../lib/useApi';

interface Preview {
  defaultCurrency: string;
  currencies: { currency: string; billedAmount: string; overlaps: { ref: number } | null }[];
}

export function InvoiceCurrencyPicker({ previewPath, value, onChange, what }: {
  /** null until the account and period are chosen. */
  previewPath: string | null; value: string; onChange: (currency: string) => void; what: 'earned' | 'billed';
}) {
  const { data, loading, error } = useQuery<Preview>(previewPath);

  // Pick a sensible currency when the preview changes: keep a still-valid choice, else the first
  // currency that can be invoiced, else (no activity) the default.
  useEffect(() => {
    if (!data) return;
    const ok = (c: string) => data.currencies.some((x) => x.currency === c && !x.overlaps) || (!data.currencies.length && c === data.defaultCurrency);
    if (value && ok(value)) return;
    onChange(data.currencies.find((x) => !x.overlaps)?.currency ?? (data.currencies.length ? '' : data.defaultCurrency));
  }, [data, value, onChange]);

  if (!previewPath) return <p className="text-tiny text-fg-secondary">Choose the account and the period to see the amounts per currency.</p>;
  if (loading && !data) return <p className="text-tiny text-fg-secondary">Checking the ledger…</p>;
  if (error) return <p className="text-tiny text-danger-text">{error}</p>;
  if (!data) return null;
  if (!data.currencies.length) {
    return <p className="text-tiny text-fg-secondary">Nothing {what} in this period — the invoice would be {data.defaultCurrency} 0.00.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="divide-y divide-border rounded-[var(--radius)] border border-border">
        {data.currencies.map((c) => (
          <label key={c.currency} className={`flex items-center gap-3 px-3 py-2 text-small ${c.overlaps ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
            <input type="radio" name="invoice-currency" value={c.currency} checked={value === c.currency} disabled={!!c.overlaps}
              onChange={() => onChange(c.currency)} />
            <span className="w-12 font-medium text-fg">{c.currency}</span>
            <span className="flex-1 text-fg">{c.billedAmount} {what}</span>
            {c.overlaps && <span className="text-tiny text-fg-muted">already invoiced (#{c.overlaps.ref})</span>}
          </label>
        ))}
      </div>
      {data.currencies.length > 1 && (
        <p className="text-tiny text-fg-secondary">One invoice per currency — create another invoice for each other currency. Amounts are never converted.</p>
      )}
    </div>
  );
}
