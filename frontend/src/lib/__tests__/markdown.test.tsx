import { describe, it } from 'vitest';
import assert from 'node:assert';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../markdown.tsx';

const html = (src: string) => renderToStaticMarkup(<Markdown source={src} />);

describe('Markdown (help articles, changelog)', () => {
  it('headings, paragraphs, bold / italic / code, lists, quotes, code blocks', () => {
    const out = html('# Title\n\nHello **world** and *you* with `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n> note\n\n```\nnpm run dev\n```');
    assert.match(out, /<h2[^>]*>Title<\/h2>/);
    assert.match(out, /<strong>world<\/strong>/);
    assert.match(out, /<em>you<\/em>/);
    assert.match(out, /<code[^>]*>code<\/code>/);
    assert.match(out, /<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(out, /<ol[^>]*><li>first<\/li><li>second<\/li><\/ol>/);
    assert.match(out, /<blockquote[^>]*>note<\/blockquote>/);
    assert.match(out, /<pre[^>]*>npm run dev<\/pre>/);
  });

  it('never renders raw HTML or unsafe links', () => {
    const out = html('<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://example.com) [in-app](/app/help) [proto](//evil.com)');
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('&lt;script&gt;'));
    assert.ok(!out.includes('javascript:'));
    assert.match(out, /<a href="https:\/\/example.com"[^>]*target="_blank"/);
    assert.match(out, /<a href="\/app\/help"/);
    assert.ok(!out.includes('href="//evil.com"'));
  });
});
