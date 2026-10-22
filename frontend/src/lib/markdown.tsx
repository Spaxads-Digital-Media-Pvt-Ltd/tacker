/**
 * A small, safe markdown renderer for help articles and changelog entries — React elements, never raw
 * HTML (so an article can't inject script), no dependency. Supports: # / ## / ### headings, paragraphs,
 * **bold**, *italic*, `code`, [links](https://…) (http(s), mailto and in-app /paths only), - and 1.
 * lists, > quotes, ``` code blocks and --- rules. Anything else is shown as plain text.
 */
import { Fragment, type ReactNode } from 'react';

const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/))/i;

/** Inline marks inside one line of text. */
function renderInline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] != null) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3] != null) out.push(<em key={k}>{m[3]}</em>);
    else if (m[4] != null) out.push(<code key={k} className="rounded bg-page px-1 font-mono text-[0.9em]">{m[4]}</code>);
    else if (m[5] != null) {
      const href = m[6]!;
      out.push(SAFE_HREF.test(href)
        ? <a key={k} href={href} className="text-accent-text hover:underline" {...(/^https?:/i.test(href) ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>{m[5]}</a>
        : <Fragment key={k}>{m[5]}</Fragment>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  const flushPara = (para: string[]) => { if (para.length) blocks.push(<p key={`b${b++}`} className="my-2 leading-relaxed">{renderInline(para.join(' '), `p${b}`)}</p>); };
  let para: string[] = [];
  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (t.startsWith('```')) {
      flushPara(para); para = [];
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) code.push(lines[i++]!);
      i++;
      blocks.push(<pre key={`b${b++}`} className="my-3 overflow-x-auto rounded-[var(--radius)] bg-page p-3 font-mono text-tiny">{code.join('\n')}</pre>);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      flushPara(para); para = [];
      const level = h[1]!.length;
      const cls = level === 1 ? 'mt-4 mb-2 text-h2 font-semibold' : level === 2 ? 'mt-4 mb-2 text-h3 font-semibold' : 'mt-3 mb-1 font-semibold';
      blocks.push(level === 1 ? <h2 key={`b${b++}`} className={cls}>{renderInline(h[2]!, `h${b}`)}</h2>
        : level === 2 ? <h3 key={`b${b++}`} className={cls}>{renderInline(h[2]!, `h${b}`)}</h3>
        : <h4 key={`b${b++}`} className={cls}>{renderInline(h[2]!, `h${b}`)}</h4>);
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) { flushPara(para); para = []; blocks.push(<hr key={`b${b++}`} className="my-4 border-border" />); i++; continue; }
    if (/^[-*]\s+/.test(t) || /^\d+\.\s+/.test(t)) {
      flushPara(para); para = [];
      const ordered = /^\d+\.\s+/.test(t);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\.\s+/ : /^[-*]\s+/).test(lines[i]!.trim())) items.push(lines[i++]!.trim().replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ''));
      const lis = items.map((it, k) => <li key={k}>{renderInline(it, `l${b}-${k}`)}</li>);
      blocks.push(ordered ? <ol key={`b${b++}`} className="my-2 list-decimal space-y-1 pl-5">{lis}</ol> : <ul key={`b${b++}`} className="my-2 list-disc space-y-1 pl-5">{lis}</ul>);
      continue;
    }
    if (t.startsWith('>')) {
      flushPara(para); para = [];
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) quote.push(lines[i++]!.trim().replace(/^>\s?/, ''));
      blocks.push(<blockquote key={`b${b++}`} className="my-3 border-l-2 border-accent pl-3 text-fg-secondary">{renderInline(quote.join(' '), `q${b}`)}</blockquote>);
      continue;
    }
    if (!t) { flushPara(para); para = []; i++; continue; }
    para.push(t);
    i++;
  }
  flushPara(para);
  return <div className={`text-small text-fg ${className}`}>{blocks}</div>;
}
