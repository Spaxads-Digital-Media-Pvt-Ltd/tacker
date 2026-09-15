import { describe, it, expect } from 'vitest';
import { getRedirectUrlRejectReason } from '../../src/lib/url-security.js';

describe('getRedirectUrlRejectReason', () => {
 const validUrls = [
 'https://example.com',
 'https://example.com/path',
 'https://example.com/path?q=1',
 'HTTPS://EXAMPLE.COM',
 'http://localhost:3000',
 'http://127.0.0.1/x',
 ];

 for (const url of validUrls) {
 it(`accepts valid url: ${url}`, () => {
 expect(getRedirectUrlRejectReason(url)).toBeNull();
 });
 }

 const badUrls: [string, string][] = [
 ['javascript:alert(1)', 'unsafe_scheme'],
 ['JavaScript:alert(1)', 'unsafe_scheme'],
 ['data:text/html,<script>alert(1)</script>', 'unsafe_scheme'],
 ['vbscript:msgbox("x")', 'unsafe_scheme'],
 ['file:///etc/passwd', 'unsafe_scheme'],
 ['ftp://example.com', 'unsafe_scheme'],
 ];

 for (const [url, reason] of badUrls) {
 it(`rejects ${url.split(':')[0]} scheme: ${url}`, () => {
 expect(getRedirectUrlRejectReason(url)).toBe(reason);
 });
 }

 it('rejects URL-encoded control chars (CRLF) — new URL() rejects', () => {
 expect(getRedirectUrlRejectReason('https://evil.com%0d%0aX-Evil: 1')).toBe('malformed_url');
 });

 it('rejects URL-encoded null byte — new URL() rejects', () => {
 expect(getRedirectUrlRejectReason('https://evil.com%00evil')).toBe('malformed_url');
 });

 it('accepts empty string (no-op redirect)', () => {
 expect(getRedirectUrlRejectReason('')).toBeNull();
 });

 it('rejects null input as safe no-op', () => {
 expect(getRedirectUrlRejectReason(null as unknown as string)).toBeNull();
 });

 it('rejects undefined input as safe no-op', () => {
 expect(getRedirectUrlRejectReason(undefined as unknown as string)).toBeNull();
 });

 it('rejects protocol-relative URLs', () => {
 expect(getRedirectUrlRejectReason('//evil.com')).toBe('malformed_url');
 });

 it('accepts http (non-https is still valid redirect)', () => {
 expect(getRedirectUrlRejectReason('http://example.com')).toBeNull();
 });
});
