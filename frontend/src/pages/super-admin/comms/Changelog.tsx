/** Super Admin › Comms › Changelog — "What's new" entries (new / improved / fixed), shown in the app once published. */
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { Markdown } from '../../../lib/markdown';
import { PageHeader, Modal, Field, Spinner, StateBlock } from '../../../shared-components/primitives/ui';
import { Chip } from '../kit';
import type { ChangelogEntry } from '../../../lib/platformComms';

const KIND_CHIP: Record<string, string> = { new: 'bg-success-bg text-success-text', improved: 'bg-info-bg text-info-text', fixed: 'bg-warning-bg text-warning-text' };

function EntryEditor({ initial, onClose, onSaved }: { initial: ChangelogEntry | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: initial?.title ?? '', body: initial?.body ?? '', kind: initial?.kind ?? 'new', status: initial?.status ?? 'draft' });
  const save = useMutation((body: Record<string, unknown>) => (initial ? api.patch(`/platform/changelog/${initial.id}`, body) : api.post('/platform/changelog', body)));
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await save.run({ ...f, title: f.title.trim() })) onSaved(); };
  return (
    <Modal open size="xl" onClose={onClose} title={initial ? 'Edit entry' : 'New entry'}
      footer={<><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="entry" className="btn-primary" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="entry" onSubmit={submit} className="space-y-3">
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <Field label="Title"><input className="input" required maxLength={200} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind"><select className="input" value={f.kind} onChange={(e) => setF((s) => ({ ...s, kind: e.target.value as ChangelogEntry['kind'] }))}><option value="new">New</option><option value="improved">Improved</option><option value="fixed">Fixed</option></select></Field>
          <Field label="Status"><select className="input" value={f.status} onChange={(e) => setF((s) => ({ ...s, status: e.target.value as 'draft' | 'published' }))}><option value="draft">Draft</option><option value="published">Published</option></select></Field>
        </div>
        <Field label="Details (markdown)"><textarea className="input min-h-[10rem] font-mono text-small" value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} /></Field>
      </form>
    </Modal>
  );
}

export default function Changelog() {
  const canEdit = usePlatformMe().can('comms', 'full');
  const confirm = useConfirm();
  const list = useQuery<ChangelogEntry[]>('/platform/changelog');
  const [editing, setEditing] = useState<ChangelogEntry | null | 'new'>(null);
  return (
    <>
      <PageHeader title="Changelog" subtitle="“What’s new” in the app — every network sees published entries."
        action={canEdit ? <button className="btn-primary" onClick={() => setEditing('new')}>New entry</button> : undefined} />
      {list.loading && !list.data ? <StateBlock><Spinner /></StateBlock> : list.error ? <StateBlock>{list.error}</StateBlock>
        : !(list.data ?? []).length ? <StateBlock>No entries yet.</StateBlock> : (
          <div className="space-y-3">
            {(list.data ?? []).map((e) => (
              <div key={e.id} className="card">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip className={KIND_CHIP[e.kind] ?? ''}>{e.kind}</Chip>
                  <h3 className="text-small font-semibold text-fg">{e.title}</h3>
                  {e.status === 'draft' ? <Chip className="bg-page text-fg-muted ring-1 ring-inset ring-border">Draft</Chip> : <span className="text-tiny text-fg-muted">{e.published_at ? new Date(e.published_at).toLocaleDateString() : ''}</span>}
                  {canEdit && <span className="ml-auto flex gap-3">
                    <button className="text-tiny text-accent-text hover:underline" onClick={() => setEditing(e)}>Edit</button>
                    <button className="text-tiny text-danger-text hover:underline" onClick={() => void confirm({ title: 'Delete entry?', message: `Delete "${e.title}"?`, confirmLabel: 'Delete', destructive: true, onConfirm: async () => { await api.del(`/platform/changelog/${e.id}`); list.refetch(); } })}>Delete</button>
                  </span>}
                </div>
                {e.body && <Markdown source={e.body} className="mt-2" />}
              </div>
            ))}
          </div>
        )}
      {editing && <EntryEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.refetch(); }} />}
    </>
  );
}
