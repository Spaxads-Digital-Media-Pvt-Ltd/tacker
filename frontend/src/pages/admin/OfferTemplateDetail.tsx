/**
 * Offers › Templates › Template Details — matches the reference's own dedicated page reached by
 * clicking a template's Name in the list (verified live at /offers/templates/1): a "General" card
 * (ID/Name/Default Template/Modified/Created + real Edit + a kebab) and an "Offer Fields" card
 * (a flat, real-paginated Field/Value table — not grouped, unlike the list page's "View all" modal).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, MoreVertical } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { InfoCard, InfoGrid, InfoRow } from './controlCenter/shared';
import { useFieldSpecs, valueLabel, fmtDateTime, type Template } from '../../data/offerTemplateFields';

function DateTimeValue({ iso }: { iso: string }) {
  const { date, time } = fmtDateTime(iso);
  return <>{date}<span className="mt-0.5 block text-tiny text-fg-secondary">{time}</span></>;
}

function GeneralMenu({ isDefault, onSetDefault, onDelete }: { isDefault: boolean; onSetDefault: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="grid h-7 w-7 place-items-center rounded-[var(--radius)] text-fg-secondary hover:bg-accent-subtle hover:text-fg"><MoreVertical size={15} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-card border border-border bg-elevated py-1 shadow-elevated">
            {!isDefault && <button type="button" onClick={() => { setOpen(false); onSetDefault(); }} className="block w-full px-3 py-1.5 text-left text-small text-fg hover:bg-page">Set as Default</button>}
            <button type="button" onClick={() => { setOpen(false); onDelete(); }} className="block w-full px-3 py-1.5 text-left text-small text-danger-text hover:bg-danger-bg">Delete</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function OfferTemplateDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const specs = useFieldSpecs();
  const { data, loading, refetch } = useQuery<Template>(`/api/offer-templates/${id}`);
  const del = useMutation((tid: string) => api.del(`/api/offer-templates/${tid}`));
  const setDefault = useMutation((tid: string) => api.patch(`/api/offer-templates/${tid}`, { isDefault: true }));

  if (loading || !data) return <StateBlock><Spinner /></StateBlock>;

  const rows = specs.filter((s) => data.fieldValues[s.key]);

  return (
    <>
      <PageHeader title={`Template Details: ${data.name}`} subtitle={`Offers › Offer Templates › ${data.name} › Details`} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <InfoCard title="General" action={
          <div className="flex items-center gap-1">
            <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={() => nav(`/app/offers-templates/${id}/edit`)}><Pencil size={12} />Edit</button>
            <GeneralMenu isDefault={data.isDefault}
              onSetDefault={async () => { await setDefault.run(data.id); refetch(); }}
              onDelete={async () => { if (confirm('Delete this template?')) { await del.run(data.id); nav('/app/offers-templates'); } }} />
          </div>
        }>
          <InfoGrid>
            <InfoRow label="ID" value={<span className="tabular-nums">{data.ref}</span>} />
            <InfoRow label="Modified" value={<DateTimeValue iso={data.updatedAt} />} />
            <InfoRow label="Name" value={data.name} />
            <InfoRow label="Created" value={<DateTimeValue iso={data.createdAt} />} />
            <InfoRow label="Default Template" value={data.isDefault ? 'YES' : 'NO'} />
          </InfoGrid>
        </InfoCard>

        <InfoCard title="Offer Fields" action={<span />}>
          {rows.length === 0 ? (
            <p className="text-small text-fg-muted">No pre-filled fields.</p>
          ) : (
            <div className="overflow-hidden rounded-card border border-border">
              <div className="grid grid-cols-2 gap-2 border-b border-border bg-page px-4 py-2 text-tiny font-semibold uppercase text-fg-secondary">
                <span>Field</span><span>Value</span>
              </div>
              {rows.map((s) => (
                <div key={s.key} className="grid grid-cols-2 gap-2 border-b border-border px-4 py-2.5 last:border-b-0">
                  <span className="text-small text-fg-secondary">{s.label}</span>
                  <span className="text-small text-fg">{valueLabel(s, data.fieldValues[s.key])}</span>
                </div>
              ))}
            </div>
          )}
        </InfoCard>
      </div>
    </>
  );
}
