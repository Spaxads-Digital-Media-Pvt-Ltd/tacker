/**
 * Report date range that applies on its own (no "Run Report"): the inputs are kept as typed and a
 * range is committed once it has settled (debounced — the native date input reports each typed
 * segment) and is valid. An incomplete or inverted range never reaches the API; the page keeps the
 * last good one and shows `problem`.
 *
 * The committed range and the page number live in ONE state object, so a new range resets to page
 * 1 in the same render — one request, never "new range on the old page" first.
 */
import { useEffect, useState } from 'react';
import { isYmd } from '../../lib/reportFilterState';
import { latestToday } from '../../lib/reportZone';
import { useDebounced } from './pagedList';

/** A From–To pair a report can run: real calendar days, From ≤ To, To not past today in any zone
 *  (reports are in the network's / picked zone — D7; its today can be ahead of UTC's). */
export function isValidRange(from: string, to: string): boolean {
  return isYmd(from) && isYmd(to) && from <= to && to <= latestToday();
}

function rangeProblem(from: string, to: string): string | null {
  if (!isYmd(from) || !isYmd(to)) return 'Enter complete From and To dates.';
  if (from > to) return 'From must be on or before To.';
  if (to > latestToday()) return 'To can’t be in the future.';
  return null;
}

export function useAutoDateRange(initFrom: string, initTo: string, debounceMs = 400) {
  const [from, setFrom] = useState(initFrom);
  const [to, setTo] = useState(initTo);
  const [view, setView] = useState({ from: initFrom, to: initTo, page: 1 });
  // Debounced as one value, so editing both ends in quick succession commits once.
  const [settledFrom = '', settledTo = ''] = useDebounced(`${from}|${to}`, debounceMs).split('|');
  useEffect(() => {
    if (!isValidRange(settledFrom, settledTo)) return;
    // Same range → same state object, so React skips the render (no request, page kept).
    setView((v) => (v.from === settledFrom && v.to === settledTo ? v : { from: settledFrom, to: settledTo, page: 1 }));
  }, [settledFrom, settledTo]);

  const problem = rangeProblem(from, to);
  return {
    /** Input values (as typed). */
    from, to, setFrom, setTo,
    /** The committed range the report uses. */
    appliedFrom: view.from, appliedTo: view.to,
    page: view.page,
    setPage: (page: number) => setView((v) => ({ ...v, page })),
    /** Back to page 1 — call alongside any other applied change (filters, grouping, sort…). */
    toFirstPage: () => setView((v) => (v.page === 1 ? v : { ...v, page: 1 })),
    /** Set inputs AND the committed range at once (Clear, loading a saved report). */
    reset: (r: { from: string; to: string }) => { setFrom(r.from); setTo(r.to); setView({ from: r.from, to: r.to, page: 1 }); },
    /** Inline message while the typed range can't be applied, or null. */
    problem: problem ? `${problem} The report keeps showing ${view.from} → ${view.to}.` : null,
  };
}
