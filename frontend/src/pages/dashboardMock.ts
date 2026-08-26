/**
 * Dev-only sample data for the admin dashboard. Used ONLY when a request errors AND the app is
 * running in dev (`import.meta.env.DEV`, stripped from production builds) — lets the redesigned
 * dashboard be previewed without a live api-backend. Real data always wins once the API responds.
 */

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function curve(n: number, max: number, seed: number): number[] {
  const rand = seededRandom(seed);
  let v = max * 0.05;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    v = Math.max(0, v + (rand() - 0.35) * max * 0.12);
    out.push(Math.round(v));
  }
  return out;
}

export interface MockDashboard {
  clicks: { today: number; yesterday: number; month: number; lastMonth: number };
  conversions: { today: number; yesterday: number; month: number; lastMonth: number };
  cr: { today: number; yesterday: number; month: number; lastMonth: number };
  revenue: { today: string; yesterday: string; month: string; lastMonth: string };
  payout: { today: string; yesterday: string; month: string; lastMonth: string };
  margin: { today: string; yesterday: string; month: string; lastMonth: string };
  series: { clicks: number[]; conversions: number[]; revenue: number[]; payout: number[] };
}

export const MOCK_DASHBOARD: MockDashboard = {
  clicks: { today: 1338, yesterday: 22646, month: 360000, lastMonth: 675400 },
  conversions: { today: 33, yesterday: 454, month: 7200, lastMonth: 13600 },
  cr: { today: 2.5, yesterday: 2.0, month: 2.1, lastMonth: 2.0 },
  revenue: { today: '918.50', yesterday: '12597.50', month: '212100.00', lastMonth: '395800.00' },
  payout: { today: '191.75', yesterday: '2600.00', month: '44300.00', lastMonth: '82600.00' },
  margin: { today: '726.75', yesterday: '9997.50', month: '167800.00', lastMonth: '313200.00' },
  series: {
    clicks: curve(24, 1400, 1),
    conversions: curve(24, 36, 2),
    revenue: curve(24, 950, 3),
    payout: curve(24, 200, 4),
  },
};

type EntityKind = 'offer' | 'publisher' | 'advertiser';

const MOCK_NAMES: Record<EntityKind, { id: string; name: string }[]> = {
  offer: [
    { id: 'mock-offer-1', name: "Women's Sports Apparel - USA" },
    { id: 'mock-offer-2', name: 'Home Fitness Bundle - CA' },
    { id: 'mock-offer-3', name: 'Candle Subscription Box' },
    { id: 'mock-offer-4', name: 'Pet Supplies Flash Sale' },
    { id: 'mock-offer-5', name: 'Organic Skincare Trial' },
  ],
  publisher: [
    { id: 'mock-pub-1', name: 'Affiliate A' },
    { id: 'mock-pub-2', name: 'Affiliate B' },
    { id: 'mock-pub-3', name: 'Affiliate C' },
    { id: 'mock-pub-4', name: 'Affiliate D' },
    { id: 'mock-pub-5', name: 'Affiliate E' },
  ],
  advertiser: [
    { id: 'mock-adv-1', name: 'Candle Advertisers' },
    { id: 'mock-adv-2', name: 'Fitness Brands Co' },
    { id: 'mock-adv-3', name: 'Pet World Inc' },
    { id: 'mock-adv-4', name: 'Skin & Glow Ltd' },
    { id: 'mock-adv-5', name: 'Home & Garden LLC' },
  ],
};

export function mockNameMap(kind: EntityKind): Map<string, string> {
  return new Map(MOCK_NAMES[kind].map((e) => [e.id, e.name]));
}

interface MockAggResult { rows: { dimensions: Record<string, string | null>; metrics: Record<string, string | number> }[] }

export function mockTopRows(kind: EntityKind): MockAggResult {
  const rand = seededRandom(kind.length * 17);
  return {
    rows: MOCK_NAMES[kind].map((e, i) => ({
      dimensions: { [kind]: e.id },
      metrics: {
        clicks: Math.round(2000 * (1 - i * 0.15) * (0.85 + rand() * 0.3)),
        conversions: Math.round(60 * (1 - i * 0.15) * (0.85 + rand() * 0.3)),
        revenue: (1800 * (1 - i * 0.15) * (0.85 + rand() * 0.3)).toFixed(2),
      },
    })),
  };
}

export function mockHourlySeries(): MockAggResult {
  const revenue = curve(24, 400, 7);
  const clicks = curve(24, 900, 8);
  const conversions = curve(24, 20, 9);
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return {
    rows: revenue.map((v, i) => ({
      dimensions: { hour: new Date(start.getTime() + i * 3_600_000).toISOString() },
      metrics: { revenue: v.toFixed(2), clicks: clicks[i] ?? 0, conversions: conversions[i] ?? 0 },
    })),
  };
}
