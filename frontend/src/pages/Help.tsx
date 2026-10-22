/**
 * Help center (signed in) — the platform's published articles for this reader (network staff, partners
 * or advertisers each see their own plus everyone's): search, categories, then an article. Same page for
 * /app/help, /publisher/help and /advertiser/help.
 */
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useQuery } from '../lib/useApi';
import { useDebounced } from './admin/pagedList';
import { Markdown } from '../lib/markdown';
import { PageHeader, Spinner, StateBlock } from '../shared-components/primitives/ui';
import type { HelpArticle } from '../lib/platformComms';

const base = (pathname: string) => pathname.replace(/\/help(\/.*)?$/, '/help');

export default function Help() {
  const { slug } = useParams();
  const { pathname } = useLocation();
  return slug ? <Article slug={slug} back={base(pathname)} /> : <ArticleList base={base(pathname)} />;
}

function ArticleList({ base: root }: { base: string }) {
  const [q, setQ] = useState('');
  const search = useDebounced(q.trim(), 250);
  const list = useQuery<HelpArticle[]>('/api/help/articles', { q: search || undefined });
  const byCategory = useMemo(() => {
    const m = new Map<string, HelpArticle[]>();
    for (const a of list.data ?? []) m.set(a.category, [...(m.get(a.category) ?? []), a]);
    return [...m.entries()];
  }, [list.data]);
  return (
    <>
      <PageHeader title="Help center" subtitle="Guides and answers from the platform team" />
      <div className="relative mb-6 max-w-xl">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
        <input className="input !pl-9" placeholder="Search the help center…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.loading && !list.data ? <StateBlock><Spinner /></StateBlock> : list.error ? <StateBlock>{list.error}</StateBlock>
        : !byCategory.length ? <StateBlock>{search ? `Nothing matches “${search}”.` : 'No articles yet.'}</StateBlock> : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {byCategory.map(([cat, arts]) => (
              <div key={cat} className="card">
                <h2 className="mb-2 text-h3 font-semibold text-fg">{cat}</h2>
                <ul className="space-y-2">
                  {arts.map((a) => (
                    <li key={a.id}>
                      <Link to={`${root}/${a.slug}`} className="font-medium text-accent-text hover:underline">{a.title}</Link>
                      {a.excerpt && <p className="line-clamp-2 text-tiny text-fg-secondary">{a.excerpt.replace(/[#*`>[\]()]/g, '')}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
    </>
  );
}

function Article({ slug, back }: { slug: string; back: string }) {
  const a = useQuery<HelpArticle>(`/api/help/articles/${encodeURIComponent(slug)}`);
  if (a.loading && !a.data) return <StateBlock><Spinner /></StateBlock>;
  if (a.error || !a.data) return <StateBlock>{a.error ?? 'Article not found'} <Link to={back} className="ml-2 text-accent-text hover:underline">Back to the help center</Link></StateBlock>;
  return (
    <div className="max-w-3xl">
      <Link to={back} className="text-tiny font-medium text-accent-text hover:underline">← Help center</Link>
      <p className="mt-3 text-tiny uppercase tracking-wide text-fg-muted">{a.data.category}</p>
      <h1 className="text-h1 font-bold tracking-tight text-fg">{a.data.title}</h1>
      <p className="mt-1 text-tiny text-fg-muted">Updated {new Date(a.data.updated_at).toLocaleDateString()}</p>
      <div className="card mt-4"><Markdown source={a.data.body} /></div>
    </div>
  );
}
