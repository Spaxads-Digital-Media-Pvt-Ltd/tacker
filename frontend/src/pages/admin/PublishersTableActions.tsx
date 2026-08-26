/**
 * Manage Partners > Table Actions (the "⋮" toolbar kebab, Everflow-style). Bulk Edit routes to a
 * real full-page flow (see PublishersBulkEdit.tsx). Request Outstanding Balances has no
 * outbound-email infra to actually send a request, so it computes each selected partner's REAL
 * approved-but-unpaid ledger balance and records it as a real audit_log entry (visible on the
 * partner's own activity). Export Partners / Export User Emails are real (CSV/JSON, client-side).
 * Columns Customization and Show API Request reuse the same shared widgets as Manage Offers.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';

interface RequestBalancesResult { requested: { publisherId: string; balance: string }[] }

export function TableActionsMenu({
  selectedIds, allColumns, columnOrder, hiddenColumns, onApplyColumns, onExport, appliedFilters, onBalancesRequested,
}: {
  selectedIds: string[];
  allColumns: readonly string[];
  columnOrder: string[];
  hiddenColumns: Set<string>;
  onApplyColumns: (order: string[], hidden: Set<string>) => void;
  onExport: (kind: 'partners' | 'emails', format: 'csv' | 'json') => void;
  appliedFilters: Record<string, string | undefined>;
  onBalancesRequested: (message: string) => void;
}) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [exportPartnersOpen, setExportPartnersOpen] = useState(false);
  const [exportEmailsOpen, setExportEmailsOpen] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const requestBalances = useMutation((publisherIds: string[]) => api.post<RequestBalancesResult>('/api/publishers/request-balances', { publisherIds }));

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setExportPartnersOpen(false);
      setExportEmailsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const item = (label: string, onClick: () => void, opts?: { inert?: boolean | string; hasSubmenu?: boolean }) => (
    <button key={label} role="menuitem" title={opts?.inert ? (typeof opts.inert === 'string' ? opts.inert : 'Not available yet') : undefined} onClick={onClick}
      className={`flex w-full items-center justify-between whitespace-nowrap px-3 py-1.5 text-left text-small hover:bg-accent-subtle ${opts?.inert ? 'text-fg-muted' : 'text-fg'}`}>
      {label}
      {opts?.hasSubmenu && <ChevronRight size={13} className="text-fg-muted" />}
    </button>
  );

  const doRequestBalances = async () => {
    setOpen(false);
    const res = await requestBalances.run(selectedIds);
    if (res) {
      const total = res.requested.reduce((sum, r) => sum + Number(r.balance || 0), 0);
      onBalancesRequested(`Recorded outstanding balance for ${res.requested.length} partner${res.requested.length === 1 ? '' : 's'} (total $${total.toFixed(2)}).`);
    }
  };

  return (
    <>
      <button ref={btnRef} title="Table Actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-64 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item(`Bulk Edit${selectedIds.length ? ` (${selectedIds.length})` : ''}`, () => {
            setOpen(false);
            nav('/app/publishers/bulk-edit', { state: { selectedIds } });
          })}
          {item(requestBalances.busy ? 'Requesting…' : 'Request Outstanding Balances', doRequestBalances,
            { inert: selectedIds.length === 0 ? 'Select at least one partner first' : false })}
          <div className="my-1 border-t border-border" />
          <div className="relative" onMouseEnter={() => setExportPartnersOpen(true)} onMouseLeave={() => setExportPartnersOpen(false)}>
            {item('Export Partners', () => setExportPartnersOpen((s) => !s), { hasSubmenu: true })}
            {exportPartnersOpen && (
              <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                {item('CSV', () => { setOpen(false); setExportPartnersOpen(false); onExport('partners', 'csv'); })}
                {item('JSON', () => { setOpen(false); setExportPartnersOpen(false); onExport('partners', 'json'); })}
              </div>
            )}
          </div>
          <div className="relative" onMouseEnter={() => setExportEmailsOpen(true)} onMouseLeave={() => setExportEmailsOpen(false)}>
            {item('Export User Emails', () => setExportEmailsOpen((s) => !s), { hasSubmenu: true })}
            {exportEmailsOpen && (
              <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                {item('CSV', () => { setOpen(false); setExportEmailsOpen(false); onExport('emails', 'csv'); })}
                {item('JSON', () => { setOpen(false); setExportEmailsOpen(false); onExport('emails', 'json'); })}
              </div>
            )}
          </div>
          <div className="my-1 border-t border-border" />
          {item('Columns Customization', () => { setOpen(false); setShowColumns(true); })}
          {item('Show API Request', () => { setOpen(false); setShowApiRequest(true); })}
        </div>,
        document.body,
      )}
      {showColumns && <ColumnsModal allColumns={allColumns} order={columnOrder} hidden={hiddenColumns} onClose={() => setShowColumns(false)} onApply={onApplyColumns} />}
      {showApiRequest && <ApiRequestModal path="/api/publishers?limit=100&offset=0" onClose={() => setShowApiRequest(false)} appliedFilters={appliedFilters} />}
    </>
  );
}
