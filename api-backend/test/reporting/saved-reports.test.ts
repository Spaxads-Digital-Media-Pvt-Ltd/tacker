/**
 * Scheduled saved reports (audit F-24), the pure parts: the rolling range a run covers (whole local
 * days in the network's zone), the saved page config → the report request the page itself makes,
 * the CSV attachment (formula-safe, entity names next to their ids), and who a run emails (D4).
 */
import { describe, it, expect } from 'vitest';
import { presetRange, savedReportRequest, reportCsv, deliveryFor, type ReportOwner } from '../../src/lib/reporting/saved-reports.js';
import type { ReportResult } from '../../src/lib/reporting/types.js';

// 08:30 on Wed 14 Oct in Kolkata; still Tue 13 Oct (23:00) in New York.
const NOW = new Date('2026-10-14T03:00:00Z');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('presetRange', () => {
  it('yesterday is the whole previous local day of the zone', () => {
    expect(presetRange('yesterday', NOW, 'Asia/Kolkata'))
      .toEqual({ from: '2026-10-12T18:30:00.000Z', to: '2026-10-13T18:29:59.999999Z', label: '2026-10-13' });
    expect(presetRange('yesterday', NOW, 'America/New_York'))
      .toEqual({ from: '2026-10-12T04:00:00.000Z', to: '2026-10-13T03:59:59.999999Z', label: '2026-10-12' });
    expect(presetRange('yesterday', NOW, 'UTC'))
      .toEqual({ from: '2026-10-13T00:00:00.000Z', to: '2026-10-13T23:59:59.999999Z', label: '2026-10-13' });
  });

  it('last 7 / 30 days end with yesterday; month to date runs to now; last month is the calendar month', () => {
    expect(presetRange('last_7_days', NOW, 'UTC'))
      .toEqual({ from: '2026-10-07T00:00:00.000Z', to: '2026-10-13T23:59:59.999999Z', label: '2026-10-07 – 2026-10-13' });
    expect(presetRange('last_30_days', NOW, 'UTC'))
      .toEqual({ from: '2026-09-14T00:00:00.000Z', to: '2026-10-13T23:59:59.999999Z', label: '2026-09-14 – 2026-10-13' });
    expect(presetRange('month_to_date', NOW, 'Asia/Kolkata'))
      .toEqual({ from: '2026-09-30T18:30:00.000Z', label: '2026-10-01 – 2026-10-14' });
    expect(presetRange('last_month', new Date('2026-01-10T12:00:00Z'), 'UTC'))
      .toEqual({ from: '2025-12-01T00:00:00.000Z', to: '2025-12-31T23:59:59.999999Z', label: '2025-12' });
  });
});

describe('savedReportRequest', () => {
  it("maps the page's filters, exclusions, Ignore Fail Traffic and sort to the request the page makes", () => {
    const req = savedReportRequest('net-1', 'partner-report', {
      from: '2020-01-01', to: '2020-01-31', // the saved page dates are replaced by the rolling range
      filters: { offer: [A], partner: [A, B, 'not-a-uuid'], country: ['in', 'us'], device: ['mobile'], advertiser: [] },
      exclusions: { advertiser: [B], country: ['cn'] },
      metricFilters: { clicks: { op: 'gt', value: '10' } }, ignoreFailTraffic: true,
      orderBy: 'revenue', orderDir: 'asc', hiddenColumns: ['cr'],
    }, 'yesterday', NOW, 'Asia/Kolkata');
    expect(req).toMatchObject({
      networkId: 'net-1', groupBy: ['publisher'], limit: 1000, offset: 0, orderBy: 'revenue', orderDir: 'asc',
      timeZone: 'Asia/Kolkata', moneyFields: ['payout', 'revenue', 'margin'],
    });
    expect(req.filters).toEqual({
      from: '2026-10-12T18:30:00.000Z', to: '2026-10-13T18:29:59.999999Z',
      offerId: A, publisherId: [A, B], country: ['IN', 'US'], device: 'mobile',
      excludeAdvertiserId: B, excludeCountry: 'CN', excludeInvalid: true,
    });
    expect(req.metrics).not.toContain('money_by_currency');
  });

  it('each page groups by its own dimension; Flex / Nested by their saved dimensions', () => {
    const groupOf = (page: Parameters<typeof savedReportRequest>[1], config: Record<string, unknown> = {}) =>
      savedReportRequest('n', page, config, 'yesterday', NOW, 'UTC').groupBy;
    expect(groupOf('offer-report')).toEqual(['offer']);
    expect(groupOf('advertiser-report')).toEqual(['advertiser']);
    expect(groupOf('smartlink-report')).toEqual(['smartLink']);
    expect(groupOf('daily-report')).toEqual(['day']);
    expect(groupOf('hourly-report')).toEqual(['hour']);
    expect(groupOf('flex-report', { dims: ['country', 'bogus', 'offer'] })).toEqual(['country', 'offer']);
    expect(groupOf('nested-report', { parentDim: 'offer', childDim: 'device' })).toEqual(['offer', 'device']);
    expect(groupOf('flex-report', { dims: ['bogus'] })).toEqual(['day']); // nothing usable → by day
  });

  it('a sort the API cannot do is dropped; UTC sends no time zone', () => {
    for (const orderBy of ['currencies', 'nope', 42]) {
      const req = savedReportRequest('n', 'offer-report', { orderBy }, 'yesterday', NOW, 'UTC');
      expect(req.orderBy).toBeUndefined();
      expect(req.timeZone).toBeUndefined();
    }
    // Daily / Hourly's default order ('' = chronological) is no sort at all.
    expect(savedReportRequest('n', 'daily-report', { orderBy: '' }, 'yesterday', NOW, 'UTC').orderBy).toBeUndefined();
  });

  it('a malformed config never throws', () => {
    const req = savedReportRequest('n', 'offer-report', { filters: 'x', exclusions: null, dims: 5 } as Record<string, unknown>, 'last_7_days', NOW, 'UTC');
    expect(req.filters).toEqual({ from: '2026-10-07T00:00:00.000Z', to: '2026-10-13T23:59:59.999999Z' });
  });
});

describe('reportCsv', () => {
  it('entity columns carry the name and the id; lists are |-joined; quoting per RFC 4180', () => {
    const result: ReportResult = {
      groupBy: ['publisher', 'day'], metrics: ['clicks', 'payout', 'currencies'], total: 2,
      rows: [
        { dimensions: { publisher: A, day: '2026-10-13' }, metrics: { clicks: 10, payout: '12.5000', currencies: ['EUR', 'USD'] }, labels: { publisher: { ref: 7, name: 'Acme, "Ltd"' } } },
        { dimensions: { publisher: B, day: '2026-10-13' }, metrics: { clicks: 0, payout: '-3.2500', currencies: [] }, labels: { publisher: null } },
      ],
    };
    expect(reportCsv(result)).toBe(
      'partner,partner_id,day,clicks,payout,currencies\r\n'
      + `"Acme, ""Ltd""",${A},2026-10-13,10,12.5000,EUR|USD\r\n`
      + `,${B},2026-10-13,0,-3.2500,\r\n`);
  });

  it('a name a spreadsheet would run as a formula is neutralised; negative numbers stay numbers', () => {
    const result: ReportResult = {
      groupBy: ['offer', 'sub1'], metrics: ['margin'], total: 3,
      rows: [
        { dimensions: { offer: A, sub1: '@SUM(1+1)' }, metrics: { margin: '-1.0000' }, labels: { offer: { ref: 1, name: '=HYPERLINK("http://evil.example","x")' } } },
        { dimensions: { offer: B, sub1: '-' }, metrics: { margin: '+2' }, labels: { offer: { ref: 2, name: '+cmd' } } },
      ],
    };
    expect(reportCsv(result).split('\r\n')).toEqual([
      'offer,offer_id,sub1,margin',
      `"'=HYPERLINK(""http://evil.example"",""x"")",${A},'@SUM(1+1),-1.0000`,
      `'+cmd,${B},'-,+2`,
      '',
    ]);
  });
});

describe("deliveryFor — a run is emailed with its owner's permissions (D4)", () => {
  const owner = (role: string, status = 'active'): ReportOwner => ({ loginId: A, name: 'Sam', email: ' Sam@Example.com ', role, status });
  const saved = ['ops@example.com', 'sam@example.com'];

  it('admins and managers: the saved recipients', () => {
    expect(deliveryFor(owner('admin'), saved)).toEqual({ recipients: saved, ownerOnly: false });
    expect(deliveryFor(owner('manager'), saved)).toEqual({ recipients: saved, ownerOnly: false });
  });
  it('Finance and Read-only: their own current email only, whatever is saved', () => {
    expect(deliveryFor(owner('finance'), saved)).toEqual({ recipients: ['sam@example.com'], ownerOnly: true });
    expect(deliveryFor(owner('read_only'), ['sam@example.com'])).toEqual({ recipients: ['sam@example.com'], ownerOnly: false });
    expect(deliveryFor(owner('read_only'), [])).toEqual({ recipients: ['sam@example.com'], ownerOnly: false });
  });
  it('a disabled owner: nobody; no team-member row: the saved recipients, as before', () => {
    expect(deliveryFor(owner('admin', 'disabled'), saved)).toEqual({ refused: "Not sent: its owner's account is disabled." });
    expect(deliveryFor(null, saved)).toEqual({ recipients: saved, ownerOnly: false });
  });
});
