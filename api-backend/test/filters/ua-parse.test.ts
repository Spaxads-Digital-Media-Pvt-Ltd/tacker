/**
 * parseUA (lib/ua.ts) is what /click stores as clicks.device / os / browser. These pin its output for
 * real User-Agent strings so the report's values are traceable to the request — nothing defaulted to
 * Chrome / Windows. (The Click report shows reduced-UA values with honest precision on top of this —
 * frontend lib/userAgentDisplay.ts.)
 */
import { describe, it, expect } from 'vitest';
import { parseUA } from '../../src/lib/ua.js';

const UA = {
  chromeWinReduced: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
  androidReduced: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
};

describe('parseUA — values come from the actual User-Agent', () => {
  it('Chrome on Windows (reduced UA): the version is literally what Chrome sends', () => {
    expect(parseUA(UA.chromeWinReduced)).toMatchObject({ browser: 'Chrome 155.0.0.0', os: 'Windows 10', device: 'desktop', browserName: 'Chrome', osName: 'Windows' });
  });
  it('different browsers / platforms are told apart', () => {
    expect(parseUA(UA.edgeWin)).toMatchObject({ browserName: 'Edge', osName: 'Windows' });
    expect(parseUA(UA.firefoxLinux)).toMatchObject({ browser: 'Firefox 133.0', osName: 'Linux', device: 'desktop' });
    expect(parseUA(UA.safariMac)).toMatchObject({ browser: 'Safari 18.2', osName: 'Mac OS' });
    expect(parseUA(UA.iphone)).toMatchObject({ browser: 'Mobile Safari 18.2', os: 'iOS 18.2', device: 'mobile', deviceBrand: 'Apple' });
    expect(parseUA(UA.androidReduced)).toMatchObject({ osName: 'Android', device: 'mobile' });
  });
  it('a missing User-Agent stays missing — no default browser / OS / device', () => {
    for (const v of [undefined, '']) {
      expect(parseUA(v)).toEqual({ device: null, os: null, browser: null, osName: null, osVersion: null, browserName: null, deviceBrand: null });
    }
  });
  it('unknown / malformed User-Agents yield no browser or OS (never Chrome / Windows)', () => {
    for (const v of ['curl/8.5.0', '!!!garbage###', 'python-requests/2.32.3']) {
      const r = parseUA(v);
      expect(r.browser).toBeNull();
      expect(r.os).toBeNull();
    }
  });
});
