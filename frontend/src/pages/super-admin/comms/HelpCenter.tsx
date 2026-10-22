/**
 * Super Admin › Comms › Help center — markdown articles for everyone, network staff, partners or
 * advertisers. Published ones appear in the app's Help (search + categories); drafts don't.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { usePlatformMe } from '../../../lib/platformMe';
import { useConfirm } from '../../../shared-components/primitives/confirm';
import { Markdown } from '../../../lib/markdown';
import { PageHeader, Table, Modal, Field, Spinner, StateBlock, type Column } from '../../../shared-components/primitives/ui';
import { Chip } from '../kit';
import type { HelpArticle } from '../../../lib/platformComms';

const AUDIENCE_LABEL: Record<string, string> = { all: 'Everyone', staff: 'Network staff', partner: 'Partners', advertiser: 'Advertisers' };
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);

function ArticleEditor({ initial, onClose, onSaved }: { initial: HelpArticle | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    title: initial?.title ?? '', slug: initial?.slug ?? '', category: initial?.category ?? 'General', body: initial?.body ?? '',
    audience: initial?.audience ?? 'all', status: initial?.status ?? 'draft', position: String(initial?.position ?? 0),
  });
  const [preview, setPreview] = useState(false);
  const save = useMutation((body: Record<string, unknown>) => (initial ? api.patch(`/platform/help-articles/${initial.id}`, body) : api.post('/platform/help-articles', body)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await save.run({ ...f, title: f.title.trim(), slug: f.slug.trim() || slugify(f.title), position: Number(f.position) || 0 })) onSaved();
  };
  return (
    <Modal open size="xl" onClose={onClose} title={initial ? `Edit: ${initial.title}` : 'New article'}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="article" className="btn-primary" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="article" onSubmit={submit} className="space-y-3">
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title"><input className="input" required maxLength={200} value={f.title} onChange={(e) => setF((s) => ({ ...s, title: e.target.value, slug: initial || s.slug ? s.slug : '' }))} /></Field>
          <Field label="Address (slug)"><input className="input font-mono" maxLength={120} value={f.slug} placeholder={slugify(f.title) || 'getting-started'} onChange={(e) => setF((s) => ({ ...s, slug: e.target.value }))} /></Field>
          <Field label="Category"><input className="input" maxLength={80} value={f.category} onChange={(e) => setF((s) => ({ ...s, category: e.target.value }))} /></Field>
          <Field label="For">
            <select className="input" value={f.audience} onChange={(e) => setF((s) => ({ ...s, audience: e.target.value as HelpArticle['audience'] }))}>
              {Object.entries(AUDIENCE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={f.status} onChange={(e) => setF((s) => ({ ...s, status: e.target.value as HelpArticle['status'] }))}><option value="draft">Draft</option><option value="published">Published</option></select>
          </Field>
          <Field label="Order in its category"><input className="input" type="number" min={0} value={f.position} onChange={(e) => setF((s) => ({ ...s, position: e.target.value }))} /></Field>
        </div>
        <div className="flex items-center justify-between"><p className="label">Article (markdown)</p><button type="button" className="text-tiny font-medium text-accent-text" onClick={() => setPreview((p) => !p)}>{preview ? 'Edit' : 'Preview'}</button></div>
        {preview ? <div className="min-h-[12rem] rounded-[var(--radius)] border border-border p-3"><Markdown source={f.body} /></div>
          : <textarea className="input min-h-[16rem] font-mono text-small" value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} placeholder={'# Getting started\n\nWrite with **bold**, lists, [links](https://…) …'} />}
      </form>
    </Modal>
  );
}

export default function HelpCenter() {
  const canEdit = usePlatformMe().can('comms', 'full');
  const confirm = useConfirm();
  const list = useQuery<HelpArticle[]>('/platform/help-articles');
  const [editing, setEditing] = useState<HelpArticle | null | 'new'>(null);
  const [error, setError] = useState<string | null>(null);
  const columns: Column<HelpArticle>[] = [
    { header: 'Article', cell: (a) => <div><button className="font-medium text-accent-text hover:underline" onClick={() => setEditing(a)}>{a.title}</button><p className="font-mono text-tiny text-fg-muted">/{a.slug}</p></div> },
    { header: 'Category', cell: (a) => a.category },
    { header: 'For', cell: (a) => AUDIENCE_LABEL[a.audience] },
    { header: 'Status', cell: (a) => (a.status === 'published' ? <Chip className="bg-success-bg text-success-text">Published</Chip> : <Chip className="bg-page text-fg-muted ring-1 ring-inset ring-border">Draft</Chip>) },
    { header: 'Views', className: 'text-right', cell: (a) => <span className="tabular-nums">{a.views}</span> },
    { header: '', className: 'text-right', cell: (a) => (canEdit ? <button className="text-tiny text-danger-text hover:underline" onClick={() => void confirm({
      title: 'Delete article?', message: `Delete "${a.title}"?`, confirmLabel: 'Delete', destructive: true,
      onConfirm: async () => { setError(null); try { await api.del(`/platform/help-articles/${a.id}`); list.refetch(); } catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); } },
    })}>Delete</button> : null) },
  ];
  return (
    <>
      <PageHeader title="Help center" subtitle="Articles in the app’s Help — for everyone, network staff, partners or advertisers."
        action={canEdit ? <button className="btn-primary" onClick={() => setEditing('new')}>New article</button> : undefined} />
      {error && <p className="mb-3 text-small text-danger-text">{error}</p>}
      {list.loading && !list.data ? <StateBlock><Spinner /></StateBlock> : list.error ? <StateBlock>{list.error}</StateBlock>
        : !(list.data ?? []).length ? <StateBlock>No articles yet.</StateBlock>
        : <Table columns={columns} rows={list.data ?? []} rowKey={(a) => a.id} />}
      {editing && <ArticleEditor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.refetch(); }} />}
    </>
  );
}
