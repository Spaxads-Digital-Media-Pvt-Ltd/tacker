/**
 * FormSection — a group of fields, optionally collapsible (forms master prompt §3):
 *  - Collapsed content stays MOUNTED (hidden with visibility + a 0-height row), so typed values,
 *    uncontrolled inputs and native validation survive collapsing.
 *  - Auto-expands on error: `onInvalidCapture` opens it synchronously (flushSync) before the browser
 *    tries to focus the invalid control — so submit never fails with "not focusable"; it also opens
 *    when a field inside shows an error message (Field `error` → `data-field-error`).
 *  - Header is a real <button> (aria-expanded / aria-controls); the content is role="region"
 *    labelled by it. Chevron + height/opacity move over --dur-base (200 ms); none under reduced motion.
 *  - Dev-only warning when a collapsed-by-default section contains a `required` control.
 *  - `lazyMount` (Accordion only, never forms): content mounts on first open, then stays mounted.
 * Collapse state is not persisted.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import {
  EXPAND_ALL_MIN, SectionGroupContext, regionHasError, requiredInCollapsedDefault, useSectionGroup,
  type SectionGroupApi, type SectionHandle,
} from './formLogic';

export function FormSection({
  id, title, description, collapsible = false, defaultOpen, summary, filledCount, lazyMount = false,
  variant = 'inset', heading, className = '', children,
}: {
  id: string;
  title?: ReactNode;
  description?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Collapsed header summary — the field names inside. */
  summary?: string;
  /** "N filled" in the header (edit pages). */
  filledCount?: number;
  lazyMount?: boolean;
  /** `inset`: bordered block inside a form card. `card`: a standalone card (Accordion). */
  variant?: 'inset' | 'card';
  /** Wrap the header in a heading element (Accordion keeps its h3). */
  heading?: 'h2' | 'h3' | 'h4';
  className?: string;
  children: ReactNode;
}) {
  const autoId = useId();
  const headerId = `${id}-header-${autoId}`;
  const regionId = `${id}-region-${autoId}`;
  const [open, setOpenState] = useState(collapsible ? Boolean(defaultOpen) : true);
  const [mounted, setMounted] = useState(!lazyMount || open);
  const openRef = useRef(open);
  openRef.current = open;
  const regionRef = useRef<HTMLDivElement>(null);
  const group = useSectionGroup();

  const setOpen = useCallback((next: boolean) => {
    if (next) setMounted(true);
    setOpenState(next);
  }, []);

  // Expand all / Collapse all registration (collapsible sections only).
  const register = group?.register;
  useEffect(() => {
    if (!register || !collapsible) return undefined;
    return register(id, { isOpen: () => openRef.current, setOpen });
  }, [register, id, collapsible, setOpen]);
  const bump = group?.bump;
  useEffect(() => { bump?.(); }, [open, bump]);

  // Dev-only guard: required fields must never start hidden.
  useEffect(() => {
    if (import.meta.env.DEV && requiredInCollapsedDefault({ collapsible, defaultOpen, lazyMount }, regionRef.current)) {
      console.warn(`FormSection "${id}" is collapsed by default but contains a required control — required fields must stay visible.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A field inside shows an error (client or server) → open.
  useEffect(() => {
    if (collapsible && !openRef.current && regionHasError(regionRef.current)) setOpen(true);
  });

  if (!collapsible) {
    return (
      <section aria-labelledby={title ? headerId : undefined} className={className}>
        {title && (
          <div className="mb-4">
            <h3 id={headerId} className="text-small font-semibold text-fg">{title}</h3>
            {description && <p className="mt-0.5 text-tiny text-fg-secondary">{description}</p>}
          </div>
        )}
        {children}
      </section>
    );
  }

  // Invalid control inside a collapsed section: un-hide synchronously so the browser can focus it.
  const onInvalidCapture = () => { if (!openRef.current) flushSync(() => setOpen(true)); };
  const card = variant === 'card';
  const button = (
    <button type="button" id={headerId} aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(!open)}
      className={`flex w-full items-center gap-3 text-left ${card ? 'rounded-[var(--radius-card)] px-4 py-3' : 'rounded-[var(--radius)] px-4 py-3.5'}`}>
      <span className="min-w-0 flex-1">
        <span className={`block ${card ? 'text-h3 font-medium' : 'text-small font-medium'} text-fg`}>{title}</span>
        {(summary || description || filledCount) ? (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-tiny text-fg-secondary">
            {summary ?? description}
            {filledCount ? <span className="rounded-full bg-accent-subtle px-2 font-semibold text-accent-text">{filledCount} filled</span> : null}
          </span>
        ) : null}
      </span>
      <ChevronDown size={16} aria-hidden
        className={`shrink-0 text-fg-secondary transition-transform duration-base ease-out-token motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
    </button>
  );
  const Heading = heading;
  return (
    <div onInvalidCapture={onInvalidCapture} data-form-section={id}
      className={`${card ? 'card !p-0' : 'rounded-[var(--radius)] border border-border bg-subtle transition-colors duration-fast hover:border-border-hover'} ${className}`}>
      {Heading ? <Heading className="m-0">{button}</Heading> : button}
      <div id={regionId} role="region" aria-labelledby={headerId} ref={regionRef}
        className={`grid transition-[grid-template-rows,opacity,visibility] duration-base ease-out-token motion-reduce:transition-none ${open ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0'}`}>
        <div className="min-h-0 overflow-hidden">
          <div className={card ? 'border-t border-border p-4' : 'px-4 pb-4 pt-1'}>{mounted ? children : null}</div>
        </div>
      </div>
    </div>
  );
}

/** Scopes Expand all / Collapse all to one form's collapsible sections. */
export function FormSectionGroup({ children }: { children: ReactNode }) {
  const handles = useRef(new Map<string, SectionHandle>());
  const [version, setVersion] = useState(0);
  const base = useMemo(() => ({
    register: (id: string, handle: SectionHandle) => {
      handles.current.set(id, handle);
      setVersion((v) => v + 1);
      return () => { handles.current.delete(id); setVersion((v) => v + 1); };
    },
    handles: () => [...handles.current.values()],
    bump: () => setVersion((v) => v + 1),
  }), []);
  const value = useMemo<SectionGroupApi>(() => ({ ...base, version }), [base, version]);
  return <SectionGroupContext.Provider value={value}>{children}</SectionGroupContext.Provider>;
}

/** "Expand all" / "Collapse all" — renders only for 3+ collapsible sections in its group. */
export function ExpandAllToggle({ className = '' }: { className?: string }) {
  const group = useSectionGroup();
  if (!group) return null;
  const sections = group.handles();
  if (sections.length < EXPAND_ALL_MIN) return null;
  const allOpen = sections.every((s) => s.isOpen());
  const Icon = allOpen ? ChevronsDownUp : ChevronsUpDown;
  return (
    <button type="button" onClick={() => sections.forEach((s) => s.setOpen(!allOpen))}
      className={`btn-ghost !px-3 !py-1.5 text-small ${className}`}>
      <Icon size={15} aria-hidden /> {allOpen ? 'Collapse all' : 'Expand all'}
    </button>
  );
}
