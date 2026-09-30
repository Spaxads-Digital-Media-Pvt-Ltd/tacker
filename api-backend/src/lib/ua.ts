/**
 * User-agent parsing (spec §2). In-process via ua-parser-js. Cheap enough for the hot path.
 */
import { UAParser } from 'ua-parser-js';

export interface UAResult {
  device: string | null;
  os: string | null;
  browser: string | null;
  /** Split-out parts used by offer targeting (Platform / OS Version / Browser / Device Brand). */
  osName: string | null;
  osVersion: string | null;
  browserName: string | null;
  deviceBrand: string | null;
}

export function parseUA(ua: string | undefined): UAResult {
  if (!ua) return { device: null, os: null, browser: null, osName: null, osVersion: null, browserName: null, deviceBrand: null };
  const r = new UAParser(ua).getResult();
  return {
    device: r.device.type ?? 'desktop',
    os: [r.os.name, r.os.version].filter(Boolean).join(' ') || null,
    browser: [r.browser.name, r.browser.version].filter(Boolean).join(' ') || null,
    osName: r.os.name ?? null,
    osVersion: r.os.version ?? null,
    browserName: r.browser.name ?? null,
    deviceBrand: r.device.vendor ?? null,
  };
}
