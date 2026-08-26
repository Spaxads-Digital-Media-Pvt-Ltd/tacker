/**
 * Manage Advertisers > Table Actions (the "⋮" toolbar kebab, Everflow-style). Bulk Edit routes to a
 * real full-page flow (see AdvertisersBulkEdit.tsx). Export is real (CSV/JSON, client-side).
 * Columns Customization and Show API Request reuse the same shared widgets as Manage Offers/Partners.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, ChevronRight } from 'lucide-react';
import { ColumnsModal, ApiRequestModal } from '../../components/TableActionsKit';

export function TableActionsMenu({
  selectedIds, allColumns, columnOrder, hiddenColumns, onApplyColumns, onExport, appliedFilters,
}: {
  selectedIds: string[];
  allColumns: readonly string[];
  columnOrder: string[];
  hiddenColumns: Set<string>;
  onApplyColumns: (order: string[], hidden: Set<string>) => void;
  onExport: (format: 'csv' | 'json') => void;
  appliedFilters: Record<string, string | undefined>;
}) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showApiRequest, setShowApiRequest] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
      setExportOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const item = (label: string, onClick: () => void, opts?: { hasSubmenu?: boolean }) => (
    <button key={label} role="menuitem" onClick={onClick}
      className="flex w-full items-center justify-between whitespace-nowrap px-3 py-1.5 text-left text-small text-fg hover:bg-accent-subtle">
      {label}
      {opts?.hasSubmenu && <ChevronRight size={13} className="text-fg-muted" />}
    </button>
  );

  return (
    <>
      <button ref={btnRef} title="Table Actions" aria-haspopup="menu" aria-expanded={open} onClick={toggle}
        className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
        <MoreVertical size={15} />
      </button>
      {open && createPortal(
        <div ref={menuRef} role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}
          className="z-50 w-60 origin-top-right animate-fade-in rounded-card border border-border bg-elevated py-1 shadow-elevated">
          {item(`Bulk Edit${selectedIds.length ? ` (${selectedIds.length})` : ''}`, () => {
            setOpen(false);
            nav('/app/advertisers/bulk-edit', { state: { selectedIds } });
          })}
          <div className="my-1 border-t border-border" />
          <div className="relative" onMouseEnter={() => setExportOpen(true)} onMouseLeave={() => setExportOpen(false)}>
            {item('Export', () => setExportOpen((s) => !s), { hasSubmenu: true })}
            {exportOpen && (
              <div className="absolute right-full top-0 mr-1 w-32 rounded-card border border-border bg-elevated py-1 shadow-elevated">
                {item('CSV', () => { setOpen(false); setExportOpen(false); onExport('csv'); })}
                {item('JSON', () => { setOpen(false); setExportOpen(false); onExport('json'); })}
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
      {showApiRequest && <ApiRequestModal path="/api/advertisers?limit=100&offset=0" onClose={() => setShowApiRequest(false)} appliedFilters={appliedFilters} />}
    </>
  );
}
