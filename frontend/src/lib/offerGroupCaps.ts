/**
 * A usable offer-group cap value, or null. Like Pacing (and offer-cap enforcement), a non-numeric,
 * zero or negative cap — legacy rows stored before the API validated caps — means "no cap", never
 * "$NaN" or a negative limit.
 */
export function capValue(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
