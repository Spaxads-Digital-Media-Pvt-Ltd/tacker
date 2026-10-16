/** Super Admin › Support › Saved replies — answers the team reuses (inserted from a ticket's reply box; each use is counted). */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { relTime } from '../../../lib/relativeTime';
import type { Macro } from '../../../lib/platformSupport';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { PageHeader, Modal, Field, Spinner, StateBlock } from '../../../shared-components/primitives/ui';

export default function Macros() {
  const { can } = usePlatformMe();
  const canEdit = can('support', 'full');
  const macros = useQuery<Macro[]>('/platform/support/macros');
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Macro | 'new' | null>(null);
  return (
    <>
      <PageHeader title="Saved replies" subtitle="Answers your team sends again and again — insert one from any ticket."
        action={<>
          <Link to="/admin/support" className="btn-ghost">Support</Link>
          {canEdit && <button className="btn-primary" onClick={() => setEditing('new')}>New saved reply</button>}
        </>} />
      {macros.loading && !macros.data ? <StateBlock><Spinner /></StateBlock>
        : macros.error ? <StateBlock>{macros.error}</StateBlock>
        : (macros.data ?? []).length === 0 ? <StateBlock>No saved replies yet.</StateBlock>
        : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(macros.data ?? []).map((m) => (
              <div key={m.id} className="card space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-fg">{m.title}</p>
                    <p className="text-tiny text-fg-muted">Used {m.uses} time(s) · updated {relTime(m.updated_at)}{m.created_by_name ? ` · by ${m.created_by_name}` : ''}</p>
                  </div>
                  {canEdit && (
                    <span className="flex shrink-0 gap-3">
                      <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setEditing(m)}>Edit</button>
                      <button className="text-tiny font-medium text-danger-text hover:underline" onClick={() => confirm({
                        title: `Delete “${m.title}”?`, confirmLabel: 'Delete', destructive: true, message: 'The team can’t insert it any more.',
                        onConfirm: async () => { await api.del(`/platform/support/macros/${m.id}`); macros.refetch(); },
                      })}>Delete</button>
                    </span>
                  )}
                </div>
                <p className="line-clamp-6 whitespace-pre-wrap text-small text-fg-secondary">{m.body}</p>
              </div>
            ))}
          </div>
        )}
      {editing && <MacroForm macro={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); macros.refetch(); }} />}
    </>
  );
}

function MacroForm({ macro, onClose, onSaved }: { macro: Macro | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(macro?.title ?? '');
  const [body, setBody] = useState(macro?.body ?? '');
  const m = useMutation((b: { title: string; body: string }) => (macro ? api.patch(`/platform/support/macros/${macro.id}`, b) : api.post('/platform/support/macros', b)));
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await m.run({ title: title.trim(), body: body.trim() })) onSaved(); };
  return (
    <Modal open size="xl" onClose={onClose} title={macro ? `Edit “${macro.title}”` : 'New saved reply'}>
      <form onSubmit={submit} className="space-y-4">
        {m.error && <p className="text-small text-danger-text">{m.error}</p>}
        <Field label="Title"><input className="input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Postback security code" /></Field>
        <Field label="Reply"><textarea className="input min-h-[180px]" required maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={m.busy}>{m.busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
