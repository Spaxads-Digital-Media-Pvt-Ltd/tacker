import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function Accordion({ title, count, defaultOpen, children }: { title: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="card !p-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        {open ? <ChevronDown size={16} className="text-fg-secondary" /> : <ChevronRight size={16} className="text-fg-secondary" />}
        <h3 className="flex-1 text-h3 font-medium text-fg">{title}{count != null ? ` (${count})` : ''}</h3>
      </button>
      {open && <div className="border-t border-border p-4">{children}</div>}
    </div>
  );
}
