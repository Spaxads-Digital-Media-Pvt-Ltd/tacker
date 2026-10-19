/**
 * The Super Admin console's search (⌘K): networks (also by a team member's email), leads, tickets (#number),
 * invoices and staff — only the groups the member's role may see (GET /platform/search).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Contact, LifeBuoy, Receipt, Search, UserRound, X } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { Overlay } from '../primitives/ui';

interface Results {
  networks?: { id: string; name: string; slug: string; status: string }[];
  leads?: { id: string; company: string; contact_name: string | null; email: string | null; stage: string }[];
  tickets?: { id: string; number: string; subject: string; status: string; network_name: string }[];
  invoices?: { id: string; number: string; status: string; total: string; currency: string; network_name: string }[];
  staff?: { id: string; email: string; name: string | null; role_name: string }[];
}
type Row = { key: string; group: string; icon: typeof Search; title: string; hint: string; to: string };

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function PlatformSearchModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const term = useDebounced(q.trim(), 250);
  const { data, loading } = useQuery<Results>(term ? '/platform/search' : null, { q: term });
  useEffect(() => { input.current?.focus(); }, []);

  const rows: Row[] = [
    ...(data?.networks ?? []).map((n) => ({ key: `n${n.id}`, group: 'Networks', icon: Building2, title: n.name, hint: `${n.slug} · ${n.status}`, to: `/admin/networks/${n.id}` })),
    ...(data?.leads ?? []).map((l) => ({ key: `l${l.id}`, group: 'Leads', icon: Contact, title: l.company, hint: [l.contact_name, l.email, l.stage].filter(Boolean).join(' · '), to: `/admin/sales/leads/${l.id}` })),
    ...(data?.tickets ?? []).map((t) => ({ key: `t${t.id}`, group: 'Tickets', icon: LifeBuoy, title: `#${t.number} ${t.subject}`, hint: `${t.network_name} · ${t.status.replace('_', ' ')}`, to: `/admin/support/${t.id}` })),
    ...(data?.invoices ?? []).map((i) => ({ key: `i${i.id}`, group: 'Invoices', icon: Receipt, title: i.number, hint: `${i.network_name} · ${i.currency} ${i.total} · ${i.status}`, to: `/admin/invoices/${i.id}` })),
    ...(data?.staff ?? []).map((s) => ({ key: `s${s.id}`, group: 'Team', icon: UserRound, title: s.name ?? s.email, hint: `${s.email} · ${s.role_name}`, to: '/admin/team' })),
  ];
  const go = (r: Row) => { onClose(); nav(r.to); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && rows[active]) go(rows[active]!);
  };

  return (
    <Overlay onClose={onClose} className="flex items-start justify-center bg-[rgb(var(--flyout-scrim))] p-4 pt-[12vh]">
      <div role="dialog" aria-label="Search" className="w-full max-w-2xl animate-fade-in overflow-hidden rounded-card border border-border bg-elevated shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search size={18} className="text-fg-muted" />
          <input ref={input} className="flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-muted" placeholder="Search networks, leads, tickets (#1042), invoices, people…"
            value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} />
          <button type="button" aria-label="Close" className="text-fg-muted hover:text-fg" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {!term ? <p className="px-4 py-6 text-center text-small text-fg-muted">Type a name, an email, an invoice number or #ticket.</p>
            : loading && !data ? <p className="px-4 py-6 text-center text-small text-fg-muted">Searching…</p>
            : rows.length === 0 ? <p className="px-4 py-6 text-center text-small text-fg-muted">Nothing matches “{term}”.</p>
            : rows.map((r, i) => {
              const Icon = r.icon;
              const first = i === 0 || rows[i - 1]!.group !== r.group;
              return (
                <div key={r.key}>
                  {first && <p className="px-4 pb-1 pt-2 text-tiny font-semibold uppercase tracking-wide text-fg-muted">{r.group}</p>}
                  <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(r)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left ${i === active ? 'bg-accent-subtle' : 'hover:bg-page'}`}>
                    <Icon size={16} className="shrink-0 text-fg-secondary" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-small font-medium text-fg">{r.title}</span><span className="block truncate text-tiny text-fg-muted">{r.hint}</span></span>
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </Overlay>
  );
}
