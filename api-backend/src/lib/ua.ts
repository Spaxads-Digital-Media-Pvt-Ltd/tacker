/**
 * User-agent parsing (spec §2). In-process via ua-parser-js. Cheap enough for the hot path.
 */
import { UAParser } from 'ua-parser-js';

export interface UAResult {
  device: string | null;
  os: string | null;
  browser: string | null;
}

export function parseUA(ua: string | undefined): UAResult {
  if (!ua) return { device: null, os: null, browser: null };
  const r = new UAParser(ua).getResult();
  return {
    device: r.device.type ?? 'desktop',
    os: [r.os.name, r.os.version].filter(Boolean).join(' ') || null,
    browser: [r.browser.name, r.browser.version].filter(Boolean).join(' ') || null,
  };
}
