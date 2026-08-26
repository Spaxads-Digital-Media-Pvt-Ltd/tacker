import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useQuery, useMutation } from '../../../lib/useApi';
import { Badge, Modal, Field, Spinner, StateBlock } from '../../../components/ui';
import { Accordion } from '../../../components/Accordion';
import { EmptyShellTable } from '../../../components/EmptyShellTable';

interface Postback { id: string; url: string; method: string; offerId: string | null; event: string | null; status: string; createdAt: string }

function PostbackTable({ rows, onDelete }: { rows: Postback[]; onDelete: (id: string) => void }) {
  if (rows.length === 0) return <p className="px-1 py-6 text-center text-small italic text-fg-muted">No Record Found</p>;
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full min-w-[640px] text-left text-body">
        <thead className="bg-page text-tiny uppercase tracking-wide text-fg-secondary">
          <tr><th className="px-4 py-3 font-semibold">Postback URL</th><th className="px-4 py-3 font-semibold">Method</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Created</th><th /></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="max-w-md truncate px-4 py-2.5 font-mono text-tiny text-fg">{r.url}</td>
              <td className="px-4 py-2.5">{r.method}</td>
              <td className="px-4 py-2.5"><Badge value={r.status} /></td>
              <td className="px-4 py-2.5 text-tiny text-fg-secondary">{new Date(r.createdAt).toLocaleDateString()}</td>
              <td className="px-4 py-2.5 text-right"><button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => onDelete(r.id)}>Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddPostbackModal({ base, onClose, onDone }: { base: string; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [event, setEvent] = useState('');
  const { run, busy, error } = useMutation((body: Record<string, unknown>) => api.post(`${base}/postbacks`, body));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run({ url, method, event: event.trim() || null });
    if (res !== null) onDone();
  };
  return (
    <Modal open onClose={onClose} title="Add Postback">
      <form onSubmit={submit} className="space-y-3">
        {error && <p className="text-small text-danger-text">{error}</p>}
        <Field label="Postback URL (with macros)"><input className="input" type="url" required placeholder="https://pub.com/pb?cid={click_id}&payout={payout}" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
        <Field label="Method"><select className="input" value={method} onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}><option value="GET">GET</option><option value="POST">POST</option></select></Field>
        <Field label="Event name (blank = Conversion, filled = Event)"><input className="input" placeholder="purchase" value={event} onChange={(e) => setEvent(e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Real data (unlike the offer-detail Postbacks tab): `publisher_postbacks` is a genuine per-
 * publisher config table. No server-side "level" — split into Conversion/Event by whether `event`
 * is set. CPC has no backend concept at all, so it stays a static shell. */
export function PostbacksTab({ base }: { base: string }) {
  const { data, loading, error, refetch } = useQuery<Postback[]>(`${base}/postbacks`);
  const [open, setOpen] = useState(false);
  const del = useMutation((id: string) => api.del(`${base}/postbacks/${id}`));
  const remove = async (id: string) => { if (confirm('Delete this postback?')) { await del.run(id); refetch(); } };

  const conversions = (data ?? []).filter((p) => !p.event);
  const events = (data ?? []).filter((p) => p.event);

  if (loading) return <StateBlock><Spinner /></StateBlock>;
  if (error) return <StateBlock>{error}</StateBlock>;

  return (
    <div className="space-y-4">
      <Accordion title="Conversion" count={conversions.length} defaultOpen>
        <div className="mb-3 flex justify-end"><button className="btn-primary !py-1.5 !px-3 text-tiny" onClick={() => setOpen(true)}>+ Add</button></div>
        <PostbackTable rows={conversions} onDelete={remove} />
      </Accordion>
      <Accordion title="Event" count={events.length}>
        <div className="mb-3 flex justify-end"><button className="btn-primary !py-1.5 !px-3 text-tiny" onClick={() => setOpen(true)}>+ Add</button></div>
        <PostbackTable rows={events} onDelete={remove} />
      </Accordion>
      <Accordion title="CPC" count={0}>
        <EmptyShellTable addLabel="Add" entityName="CPC Postback" search={false} columns={['ID', 'Offer', 'Level', 'Status', 'Method', 'Postback URL', 'Description', 'Created', 'Modified']} />
      </Accordion>

      {open && <AddPostbackModal base={base} onClose={() => setOpen(false)} onDone={() => { setOpen(false); refetch(); }} />}
    </div>
  );
}
