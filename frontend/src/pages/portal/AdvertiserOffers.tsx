import { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Search } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Table, Badge, Spinner, StateBlock, type Column } from '../../components/ui';
import type { AdvertiserOffer } from '../../types';

const PAGE_SIZE = 50;

const STATUS_OPTS = [
 { value: '', label: 'All' },
 { value: 'active', label: 'Active', dot: 'bg-success-text' },
 { value: 'draft', label: 'Draft', dot: 'bg-fg-muted' },
 { value: 'paused', label: 'Paused', dot: 'bg-warning-text' },
 { value: 'archived', label: 'Archived', dot: 'bg-fg-muted' },
];

function useDropdown() {
 const [open, setOpen] = useState(false);
 const ref = useRef<HTMLDivElement>(null);
 useEffect(() => {
 if (!open) return;
 const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
 document.addEventListener('mousedown', onDown);
 return () => document.removeEventListener('mousedown', onDown);
 }, [open]);
 return { open, setOpen, ref };
}

function DropdownSelect({ options, value, onChange, width = 'w-36' }: { options: { value: string; label: string; dot?: string }[]; value: string; onChange: (v: string) => void; width?: string }) {
 const { open, setOpen, ref } = useDropdown();
 const current = options.find((o) => o.value === value) ?? options[0]!;
 return (
 <div ref={ref} className="relative">
 <button type="button" className={`input !w-auto flex items-center gap-1.5 ${width}`} onClick={() => setOpen((o) => !o)}>
 {current.dot && <span className={`h-2 w-2 rounded-full ${current.dot}`} />}
 {current.label} <ChevronDown size={13} className="text-fg-muted" />
 </button>
 {open && (
 <div className={`absolute left-0 top-full z-30 mt-1 ${width} rounded-card border border-border bg-elevated py-1 shadow-elevated`}>
 {options.map((o) => (
 <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }}
 className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
 {o.dot && <span className={`h-2 w-2 rounded-full ${o.dot}`} />}
 {o.label}
 {o.value === value && <span className="ml-auto text-accent-text">✓</span>}
 </button>
 ))}
 </div>
 )}
 </div>
 );
}

export default function AdvertiserOffers() {
 const [q, setQ] = useState('');
 const [status, setStatus] = useState('');
 const [page, setPage] = useState(1);

 const params = useMemo(() => {
 const p = new URLSearchParams();
 p.set('limit', String(PAGE_SIZE));
 p.set('offset', String((page - 1) * PAGE_SIZE));
 if (q.trim()) p.set('q', q.trim());
 if (status) p.set('status', status);
 return p.toString();
 }, [q, status, page]);

 const { data, loading, error } = useQuery<AdvertiserOffer[]>(`/api/portal/offers?${params}`);
 const total = (data as { pagination?: { total: number } } | undefined)?.['pagination']?.total ?? 0;
 const rows = data ?? [];
 const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

 const columns: Column<AdvertiserOffer>[] = [
 { header: 'Offer', cell: (o) => <Link to={`/advertiser/offers/${o.id}`} className="font-medium text-accent-text hover:underline">{o.name}</Link> },
 { header: 'Status', cell: (o) => <Badge value={o.status} /> },
 { header: 'Model', cell: (o) => o.payoutModel },
 { header: 'Revenue', cell: (o) => <span className="font-semibold text-fg">{o.currency} {o.revenue}</span> },
 { header: 'Destination', cell: (o) => <span className="truncate font-mono text-tiny text-fg-secondary max-w-[220px] inline-block">{o.destinationUrl}</span> },
 ];

 return (
 <>
 <PageHeader title="My offers" subtitle="Your offers and their destination URLs, revenue, and tracking info." />
 <div className="mb-4 flex flex-wrap items-center gap-2">
 <div className="relative max-sm:w-full sm:w-56">
 <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
 <input className="input !pl-8" placeholder="Search offers…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
 </div>
 <DropdownSelect options={STATUS_OPTS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
 </div>
 {loading ? <StateBlock><Spinner /></StateBlock>
 : error ? <StateBlock>{error}</StateBlock>
 : rows.length === 0 ? <StateBlock>You have no offers yet.</StateBlock>
 : (
 <>
 <Table columns={columns} rows={rows} rowKey={(o) => o.id} />
 <div className="mt-3 flex items-center justify-between text-tiny text-fg-secondary">
 <span>{total} total</span>
 <div className="flex items-center gap-1">
 <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-[var(--radius)] border border-border px-2 py-1 disabled:opacity-40">‹</button>
 <span className="px-1 tabular-nums">{page} / {pageCount}</span>
 <button disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="rounded-[var(--radius)] border border-border px-2 py-1 disabled:opacity-40">›</button>
 </div>
 </div>
 </>
 )}
 </>
 );
}
