/**
 * Tag dictionary management (shared by the Offers/Affiliates/Advertisers "Tags" sub-nav items).
 * The tag dictionary is network-global; assignment to specific entities happens on their detail
 * screens. Create + delete here.
 */
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useQuery, useMutation } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';

interface Tag { id: string; name: string; color: string | null }

export default function TagsManage() {
  const { data, loading, error, refetch } = useQuery<Tag[]>('/api/tags');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const create = useMutation((body: Record<string, unknown>) => api.post('/api/tags', body));
  const del = useMutation((id: string) => api.del(`/api/tags/${id}`));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await create.run({ name, color })) { setName(''); refetch(); }
  };

  return (
    <>
      <PageHeader title="Tags" subtitle="Create and manage labels used across offers, affiliates and advertisers." />
      <form onSubmit={add} className="card mb-6 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Tag name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tier 1" />
        </div>
        <div>
          <label className="label">Color</label>
          <input type="color" className="h-10 w-14 rounded border border-border" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary" disabled={create.busy}>+ Add Tag</button>
        {create.error && <span className="text-small text-danger-text">{create.error}</span>}
      </form>

      {loading ? <StateBlock><Spinner /></StateBlock>
        : error ? <StateBlock>{error}</StateBlock>
        : !data || data.length === 0 ? <StateBlock>No tags found. Add one above.</StateBlock>
        : (
          <div className="flex flex-wrap gap-2">
            {data.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-small">
                <span className="h-3 w-3 rounded-full" style={{ background: t.color ?? '#94a3b8' }} />
                {t.name}
                <button className="text-fg-muted hover:text-danger-text" onClick={async () => { if (confirm(`Delete tag "${t.name}"?`)) { await del.run(t.id); refetch(); } }}>×</button>
              </span>
            ))}
          </div>
        )}
    </>
  );
}
