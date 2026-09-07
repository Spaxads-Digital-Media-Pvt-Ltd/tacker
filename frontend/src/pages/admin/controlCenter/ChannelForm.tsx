/**
 * Control Center › Segmentation Options › Channels › Add / Edit — matches the reference's real
 * dedicated "Add Channel" page (verified live at /controls/segmentations/channels/add): just
 * Name* and Status* (Active/Inactive segmented toggle).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useQuery, useMutation } from '../../../lib/useApi';
import { PageHeader, Field } from '../../../components/ui';
import type { PartnerChannel } from '../../../data/segmentations';

export default function ChannelForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const { data: existing } = useQuery<PartnerChannel>(isEdit ? `/api/partner-channels/${id}` : null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const hydrated = useRef(false);

  useEffect(() => {
    if (existing && !hydrated.current) {
      hydrated.current = true;
      setName(existing.name);
      setStatus(existing.status);
    }
  }, [existing]);

  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    isEdit ? api.patch(`/api/partner-channels/${id}`, body) : api.post('/api/partner-channels', body));

  const submit = async () => {
    const res = await run({ name, status });
    if (res !== null) nav('/app/control-center/segmentations');
  };

  return (
    <>
      <PageHeader title={isEdit ? 'Edit Channel' : 'Add Channel'} subtitle="Control Center › Segmentation Options › Channels" />
      <div className="card max-w-2xl space-y-5">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
        <Field label="Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Status *">
          <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
            {(['active', 'inactive'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setStatus(s)}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-small capitalize ${status === s ? 'bg-page font-medium text-fg' : 'text-fg-secondary'}`}>
                <span className={`h-2 w-2 rounded-full ${s === 'active' ? 'bg-success' : 'bg-warning'}`} />{s}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={() => nav('/app/control-center/segmentations')}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!name || busy} onClick={submit}>{busy ? 'Saving…' : isEdit ? 'Save' : 'Add'}</button>
      </div>
    </>
  );
}
