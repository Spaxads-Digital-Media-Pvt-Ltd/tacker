/**
 * Honest display of the Browser / OS stored on a click. The stored values are ua-parser-js output
 * of the click's REAL User-Agent header (tracking/app.ts → lib/ua.ts) and stay as stored (traffic
 * controls and targeting match on them); this only stops the report from claiming more precision
 * than the request carried:
 *
 *  - Reduced User-Agent (Chromium since v101–113): the browser reports only its major version and
 *    pads the rest with zeros — "Chrome/155.0.0.0". Shown as "Chrome 155", not "155.0.0.0".
 *  - "Windows NT 10.0" is sent by BOTH Windows 10 and Windows 11 → shown as "Windows 10/11".
 *  - Browsers freeze macOS at 10.15 (Firefox) / 10.15.7 (Chrome, Safari) → shown as "Mac OS 10.15+".
 *  - Reduced Android UA ("Android 10; K") freezes the version at 10 → shown as "Android 10+".
 *
 * Labels keep a version range rather than dropping it, so they never collide with a value stored
 * WITHOUT a version ("Windows", "Mac OS") — on aggregated reports those are separate rows.
 * Nothing is invented: missing / unknown values come back as null (the table shows "—").
 */

export interface UADisplay { text: string | null; note?: string }

const REDUCED_VERSION = /^(.*\S)\s+(\d+)\.0\.0\.0$/;

export function displayBrowser(stored: string | null | undefined): UADisplay {
  const s = (stored ?? '').trim();
  if (!s) return { text: null };
  const m = REDUCED_VERSION.exec(s);
  if (m) return { text: `${m[1]} ${m[2]}`, note: `Reduced User-Agent: the browser reports only its major version (sent as ${s})` };
  return { text: s };
}

export function displayOs(stored: string | null | undefined, userAgent?: string | null): UADisplay {
  const s = (stored ?? '').trim();
  if (!s) return { text: null };
  const ua = userAgent ?? '';
  if (/^Windows 10$/i.test(s) && (ua === '' || /Windows NT 10\.0/.test(ua))) {
    return { text: 'Windows 10/11', note: 'Windows 10 or 11 — the User-Agent sends "Windows NT 10.0" for both' };
  }
  if (/^Mac OS 10\.15(\.7)?$/i.test(s) && (ua === '' || /Mac OS X 10[._]15([._]7)?[;)]/.test(ua))) {
    return { text: 'Mac OS 10.15+', note: `Browsers freeze the macOS version in the User-Agent at 10.15 — the real version is 10.15 or later (sent as ${s})` };
  }
  if (/^Android 10$/i.test(s) && /Android 10; K[;)]/.test(ua)) {
    return { text: 'Android 10+', note: 'Reduced User-Agent: the Android version is frozen at 10 — the real version is 10 or later' };
  }
  return { text: s };
}

/**
 * Row label for an aggregated `os` / `browser` dimension (Analytics). Only the LABEL changes — the
 * raw stored value stays the row's key, filter value and drill-down param. No User-Agent is
 * available on aggregated rows, so a reduced Android "10" can't be told apart and stays as stored.
 * Any other dimension, or an empty value, returns `raw` unchanged.
 */
export function uaDimensionLabel(dim: string, raw: string): string {
  if (dim === 'os') return displayOs(raw).text ?? raw;
  if (dim === 'browser') return displayBrowser(raw).text ?? raw;
  return raw;
}
