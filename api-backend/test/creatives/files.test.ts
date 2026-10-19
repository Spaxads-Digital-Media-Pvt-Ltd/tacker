/**
 * Creative file helpers (audit F-27): reading the old inline data: URIs for the backfill, and the
 * content address that makes a re-run (or a fanned-out sibling) reuse one stored object.
 */
import { describe, it, expect } from 'vitest';
import { contentName, isInlineData, parseDataUri } from '../../src/lib/creatives/files.js';

describe('parseDataUri', () => {
  it('reads base64 and percent-encoded data: URIs, with or without parameters', () => {
    expect(parseDataUri('data:image/png;base64,AAEC')).toEqual({ contentType: 'image/png', bytes: Buffer.from([0, 1, 2]) });
    expect(parseDataUri('DATA:IMAGE/GIF;BASE64,R0lG')).toMatchObject({ contentType: 'image/gif' });
    const text = parseDataUri('data:text/plain;charset=utf-8,hello%20world');
    expect(text?.contentType).toBe('text/plain');
    expect(text?.bytes.toString('utf8')).toBe('hello world');
    expect(parseDataUri('data:,hi')).toMatchObject({ contentType: 'text/plain' }); // RFC 2397 default
  });

  it('anything else → null', () => {
    expect(parseDataUri('https://cdn.example.com/a.png')).toBeNull();
    expect(parseDataUri('data:image/png;base64')).toBeNull(); // no comma
    expect(parseDataUri('data:text/plain,%E0%A4%A')).toBeNull(); // broken percent-encoding
  });
});

describe('isInlineData / contentName', () => {
  it('only data: URIs are inline', () => {
    expect(isInlineData('data:image/png;base64,AA==')).toBe(true);
    expect(isInlineData('Data:text/plain,x')).toBe(true);
    expect(isInlineData('https://x.test/data:')).toBe(false);
    expect(isInlineData(null)).toBe(false);
  });

  it('the same bytes always get the same name; different bytes a different one', () => {
    const a = contentName(Buffer.from('creative'));
    expect(a).toMatch(/^sha256-[0-9a-f]{40}$/);
    expect(contentName(Buffer.from('creative'))).toBe(a);
    expect(contentName(Buffer.from('creative!'))).not.toBe(a);
  });
});
