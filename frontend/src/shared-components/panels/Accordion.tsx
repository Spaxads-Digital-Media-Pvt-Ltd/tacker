import { useId, type ReactNode } from 'react';
import { FormSection } from '../forms/FormSection';

/**
 * A titled, collapsible card — built on FormSection (button header with aria-expanded/controls,
 * region labelled by it, chevron + height motion). Content mounts on first open and then stays
 * mounted while collapsed (`lazyMount`): two callers (offer Custom Settings, offer Postbacks) render
 * CollectionTabs that fetch on mount, so a section that starts closed still sends no request until
 * it's opened — as before.
 */
export function Accordion({ title, count, defaultOpen, children }: { title: string; count?: number; defaultOpen?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <FormSection id={`accordion${id}`} collapsible defaultOpen={defaultOpen} lazyMount variant="card" heading="h3"
      title={`${title}${count != null ? ` (${count})` : ''}`}>
      {children}
    </FormSection>
  );
}
