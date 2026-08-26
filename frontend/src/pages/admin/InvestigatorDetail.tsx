/**
 * Investigation Details (General + Report tabs), reachable at /app/investigator/:id. The
 * Investigator has no backend at all (see Investigator.tsx), so the list never produces a real row
 * to click into — this represents the detail structure from the reference, always showing the same
 * "0 entries" state the reference itself shows for a fresh investigation, rather than fabricating
 * matched click/conversion rows we have no way to actually compute.
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Search, MoreVertical } from 'lucide-react';
import { PageHeader, Tabs } from '../../components/ui';
import { Accordion } from '../../components/Accordion';

export default function InvestigatorDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState<string>('General');

  return (
    <>
      <PageHeader title={`Investigation Details (${id})`} subtitle={`Investigator › Investigation (${id}) › Details`} />
      <Tabs tabs={['General', 'Report']} active={tab} onChange={setTab} />
      {tab === 'General' ? (
        <Accordion title="Investigation" defaultOpen>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <p className="text-small font-semibold text-fg">ID</p>
              <p className="mt-1 text-small text-fg-secondary">{id}</p>
            </div>
            <div>
              <p className="text-small font-semibold text-fg">Date range</p>
              <p className="mt-1 text-small text-fg-secondary">—</p>
            </div>
            <div>
              <p className="text-small font-semibold text-fg">Target</p>
              <p className="mt-1 text-small text-fg-secondary">—</p>
            </div>
            <div>
              <p className="text-small font-semibold text-fg">Suspects</p>
              <p className="mt-1 text-small text-fg-secondary">—</p>
            </div>
          </div>
        </Accordion>
      ) : (
        <Accordion title="Investigation" defaultOpen>
          <div className="mb-3 flex items-center justify-end gap-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
              <input title="Not available yet" placeholder="Search…" className="input !w-56 !pl-8" />
            </div>
            <button title="Not available yet" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius)] border border-border text-fg-secondary hover:bg-accent-subtle hover:text-fg">
              <MoreVertical size={15} />
            </button>
          </div>
          <p className="text-small text-fg-secondary">There are no results that match your investigation</p>
        </Accordion>
      )}
    </>
  );
}
