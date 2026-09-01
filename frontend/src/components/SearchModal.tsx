import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, History, Clock } from 'lucide-react';
import { useQuery } from '../lib/useApi';
import { getRecentViews, getQueryHistory, recordQuery, type RecentKind } from '../lib/recentlyViewed';
import { Icon } from './icons';
import type { Offer, Publisher, Advertiser } from '../types';

interface Result { kind: RecentKind; id: string; ref: number | null; name: string; status: string }

const KIND_LABEL: Record<RecentKind, string> = { offer: 'Offer', advertiser: 'Advertiser', partner: 'Partner' };
const KIND_ICON: Record<RecentKind, keyof typeof Icon> = { offer: 'offers', advertiser: 'building', partner: 'manager' };
const KIND_TO = (r: Result) => (r.kind === 'offer' ? `/app/offers/${r.id}` : r.kind === 'advertiser' ? `/app/advertisers/${r.id}` : `/app/publishers/${r.id}`);
const STATUS_DOT: Record<string, string> = { active: 'bg-success', pending: 'bg-warning', draft: 'bg-fg-muted', paused: 'bg-fg-muted', archived: 'bg-fg-muted', inactive: 'bg-fg-muted' };

/** Global search — real, live-filtered results across this network's Offers/Advertisers/Partners
 * (fetched fresh each time the modal opens; these lists are small in this app so client-side
 * substring filtering is fine, same approach every list page already uses). "Recently Viewed" and
 * "View Search History" are genuinely real too, backed by per-viewer localStorage (lib/recentlyViewed)
 * rather than fabricated — there's no view/search-tracking backend, so this is the honest version of
 * that feature rather than faking server-side history. */
export function SearchModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  const { data: offers } = useQuery<Offer[]>('/api/offers');
  const { data: publishers } = useQuery<Publisher[]>('/api/publishers');
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const rows: Result[] = [
      ...(offers ?? []).map((o) => ({ kind: 'offer' as const, id: o.id, ref: o.ref ?? null, name: o.name, status: o.status })),
      ...(publishers ?? []).map((p) => ({ kind: 'partner' as const, id: p.id, ref: p.ref ?? null, name: p.name, status: p.status })),
      ...(advertisers ?? []).map((a) => ({ kind: 'advertiser' as const, id: a.id, ref: a.ref ?? null, name: a.name, status: a.status })),
    ];
    return rows.filter((r) => r.name.toLowerCase().includes(query)).slice(0, 25);
  }, [q, offers, publishers, advertisers]);

  const recent = useMemo<Result[]>(
    () => getRecentViews().map((v) => ({ kind: v.kind, id: v.id, ref: v.ref, name: v.name, status: '' })),
    [],
  );
  const queryHistory = useMemo(() => getQueryHistory(), []);

  const go = (r: Result) => {
    if (q.trim()) recordQuery(q);
    onClose();
    nav(KIND_TO(r));
  };

  const row = (r: Result) => {
    const Ic = Icon[KIND_ICON[r.kind]];
    return (
      <button key={`${r.kind}-${r.id}`} type="button" onClick={() => go(r)}
        className="flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 text-left transition-colors hover:bg-accent-subtle">
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-subtle text-accent-text">
          <Ic width={16} height={16} />
          {r.status && <span className={`absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-elevated ${STATUS_DOT[r.status] ?? 'bg-fg-muted'}`} />}
        </span>
        <span className="min-w-0">
          <p className="text-tiny font-medium uppercase tracking-wide text-fg-muted">{KIND_LABEL[r.kind]}</p>
          <p className="truncate text-body text-fg">
            <span className="font-semibold">{r.name}</span>
            {r.ref != null && <span className="text-fg-secondary"> | ID {r.ref}</span>}
          </p>
        </span>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-items-center bg-black/60 p-4 pt-[8vh]" onClick={onClose}>
      <div className="max-h-[75vh] w-full max-w-2xl animate-fade-in overflow-hidden rounded-card border border-border bg-elevated shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-h2 font-semibold tracking-tight text-fg">Search</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close"><X size={20} /></button>
        </div>

        <div className="border-b border-border px-6 py-4">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              ref={inputRef}
              className="input !pl-10 !pr-16"
              placeholder="Search the app and the help center"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && q.trim() && recordQuery(q)}
            />
            {q && (
              <button type="button" onClick={() => setQ('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-tiny font-medium text-accent-text hover:underline">
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-3 py-3">
          {q.trim() ? (
            results.length ? (
              <>
                <p className="px-3 pb-1 text-h3 font-medium text-fg">Results</p>
                {results.map(row)}
              </>
            ) : (
              <p className="px-3 py-6 text-center text-small text-fg-muted">No matches for "{q}"</p>
            )
          ) : showHistory ? (
            <>
              <p className="px-3 pb-1 text-h3 font-medium text-fg">Search History</p>
              {queryHistory.length ? queryHistory.map((term) => (
                <button key={term} type="button" onClick={() => setQ(term)}
                  className="flex w-full items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 text-left text-small text-fg transition-colors hover:bg-accent-subtle">
                  <Clock size={15} className="shrink-0 text-fg-muted" />{term}
                </button>
              )) : <p className="px-3 py-6 text-center text-small text-fg-muted">No past searches yet.</p>}
            </>
          ) : (
            <>
              <p className="px-3 pb-1 text-h3 font-medium text-fg">Recently Viewed</p>
              {recent.length ? recent.map(row) : <p className="px-3 py-6 text-center text-small text-fg-muted">Nothing viewed yet — Offers, Partners, and Advertisers you open will show up here.</p>}
            </>
          )}
        </div>

        {!q.trim() && (
          <button type="button" onClick={() => setShowHistory((s) => !s)}
            className="flex w-full items-center gap-2 border-t border-border px-6 py-3 text-small font-medium text-accent-text hover:bg-accent-subtle">
            <History size={15} />{showHistory ? 'View Recently Viewed' : 'View Search History'}
          </button>
        )}
      </div>
    </div>
  );
}
