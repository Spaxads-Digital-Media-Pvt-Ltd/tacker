/** What's new — the platform's published changelog (Super Admin › Comms › Changelog). Opening it marks it read. */
import { useEffect } from 'react';
import { useQuery } from '../lib/useApi';
import { Markdown } from '../lib/markdown';
import { PageHeader, Spinner, StateBlock } from '../shared-components/primitives/ui';
import { markChangelogSeen } from '../lib/changelogSeen';
import type { ChangelogEntry } from '../lib/platformComms';

const KIND: Record<string, string> = { new: 'bg-success-bg text-success-text', improved: 'bg-info-bg text-info-text', fixed: 'bg-warning-bg text-warning-text' };

export default function WhatsNew() {
  const list = useQuery<ChangelogEntry[]>('/api/help/changelog');
  useEffect(() => { if (list.data?.[0]?.published_at) markChangelogSeen(list.data[0].published_at); }, [list.data]);
  return (
    <>
      <PageHeader title="What’s new" subtitle="New features, improvements and fixes" />
      {list.loading && !list.data ? <StateBlock><Spinner /></StateBlock> : list.error ? <StateBlock>{list.error}</StateBlock>
        : !(list.data ?? []).length ? <StateBlock>Nothing yet.</StateBlock> : (
          <ol className="relative max-w-3xl space-y-4 border-l border-border pl-5">
            {(list.data ?? []).map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                <p className="text-tiny text-fg-muted">{e.published_at ? new Date(e.published_at).toLocaleDateString() : ''}</p>
                <div className="flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-tiny font-medium capitalize ${KIND[e.kind] ?? ''}`}>{e.kind}</span><h2 className="text-small font-semibold text-fg">{e.title}</h2></div>
                {e.body && <Markdown source={e.body} className="mt-1" />}
              </li>
            ))}
          </ol>
        )}
    </>
  );
}
