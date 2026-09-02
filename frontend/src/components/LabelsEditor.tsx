/**
 * Labels (tags) editor — chips + add-by-name, using the real `${base}/tags` assign/unassign
 * endpoints (`POST {name}` find-or-create, `DELETE /:tagId`) shared by offers / partners /
 * advertisers. Two flavours:
 *   - <LabelsEditor base=…>       assigns/unassigns immediately against an entity that already
 *                                exists (edit forms).
 *   - <LabelsInput value onChange> holds names locally for a create flow where the entity has no
 *                                id yet; the caller POSTs each name once the id is known.
 */
import { useState } from 'react';
import { api } from '../lib/api';
import { useQuery, useMutation } from '../lib/useApi';
import { Field } from './ui';

interface Tag { id: string; name: string; color: string | null; createdAt: string }

function ChipBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border bg-surface p-2">
      {children}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-subtle px-2.5 py-1 text-tiny font-medium text-accent-text">
      {label}
      <button type="button" onClick={onRemove} className="text-accent-text/70 hover:text-accent-text" aria-label={`Remove ${label}`}>×</button>
    </span>
  );
}

function AddInput({ onAdd }: { onAdd: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <input
      className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-1 text-small text-fg outline-none"
      placeholder="Add label…" value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); const n = v.trim(); if (n) { onAdd(n); setV(''); } }
      }}
    />
  );
}

export function LabelsEditor({ base }: { base: string }) {
  const { data: tags, refetch } = useQuery<Tag[]>(`${base}/tags`);
  const add = useMutation((n: string) => api.post(`${base}/tags`, { name: n }));
  const remove = useMutation((tagId: string) => api.del(`${base}/tags/${tagId}`));
  return (
    <Field label="Labels">
      <ChipBox>
        {(tags ?? []).map((t) => (
          <Chip key={t.id} label={t.name} onRemove={async () => { await remove.run(t.id); refetch(); }} />
        ))}
        <AddInput onAdd={async (n) => { await add.run(n); refetch(); }} />
      </ChipBox>
    </Field>
  );
}

export function LabelsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label="Labels">
      <ChipBox>
        {value.map((name) => (
          <Chip key={name} label={name} onRemove={() => onChange(value.filter((x) => x !== name))} />
        ))}
        <AddInput onAdd={(n) => { if (!value.some((x) => x.toLowerCase() === n.toLowerCase())) onChange([...value, n]); }} />
      </ChipBox>
    </Field>
  );
}
