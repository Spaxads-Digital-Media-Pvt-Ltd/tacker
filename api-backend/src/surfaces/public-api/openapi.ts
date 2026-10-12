/**
 * OpenAPI 3 spec for the Public REST API (spec §8A "OpenAPI per audience / one spec with tagged
 * audience sections"). Served unauthenticated at /api/v1/openapi.json so each integrator sees their
 * surface. Kept hand-authored + compact; expand as endpoints are added.
 */
import { BRAND } from '../../config/branding.js';
import { AUDIENCE_SCOPES } from '../../lib/apikeys/keys.js';

const paged = {
  limit: { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
  offset: { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
};

export function openApiSpec(): Record<string, unknown> {
  const secured = [{ ApiKeyAuth: [] as string[] }];
  const op = (tag: string, summary: string, scopes: string[]) => ({
    tags: [tag], summary, security: secured,
    'x-required-scopes': scopes,
    parameters: [paged.limit, paged.offset],
    responses: { '200': { description: 'OK (standard envelope: { ok, data, pagination })' },
      '401': { description: 'Missing/invalid key' }, '403': { description: 'Wrong audience or scope' },
      '429': { description: 'Rate limited' } },
  });

  return {
    openapi: '3.0.3',
    info: {
      title: `${BRAND.name} Public REST API`,
      version: '1.0.0',
      description:
        'API-key authenticated integration API. THREE segregated audiences — advertiser, publisher, ' +
        'network — each with its own key type and namespace. A key used against the wrong namespace ' +
        'is rejected with 403 before any handler. Send the key via `X-Api-Key` or `Authorization: Bearer`.',
    },
    servers: [{ url: '/api/v1' }],
    tags: [
      { name: 'advertiser', description: `Advertiser keys (adv_live_…). Scopes: ${AUDIENCE_SCOPES.advertiser.join(', ')}` },
      { name: 'publisher', description: `Publisher keys (pub_live_…). Scopes: ${AUDIENCE_SCOPES.publisher.join(', ')}` },
      { name: 'network', description: `Network/admin keys (net_live_…). Scopes: ${AUDIENCE_SCOPES.network.join(', ')}` },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      },
    },
    paths: {
      '/advertiser/offers': { get: op('advertiser', 'List your offers (revenue, not publisher payout)', ['offers:read']) },
      '/advertiser/conversions': {
        get: op('advertiser', 'List your conversions', ['conversions:read']),
        post: {
          tags: ['advertiser'], summary: 'Post a conversion (S2S). Idempotent via txn_id or Idempotency-Key.',
          security: secured, 'x-required-scopes': ['conversions:write'],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['click_id'],
            properties: { click_id: { type: 'string' }, txn_id: { type: 'string' }, event: { type: 'string' }, status: { type: 'string' } },
          } } } },
          responses: { '201': { description: 'Recorded' }, '200': { description: 'Duplicate (idempotent)' }, '403': { description: 'Not your click / wrong audience' } },
        },
      },
      '/publisher/offers': { get: op('publisher', 'List offers available to you (payout only)', ['offers:read']) },
      '/publisher/conversions': { get: op('publisher', 'List your conversions (payout only)', ['conversions:read']) },
      '/publisher/earnings': { get: { tags: ['publisher'], summary: 'Your balance + statement (no revenue)', description: '`balances` is your approved balance per currency ([{ currency, balance }]). `balance` / `currency` are the single-currency value, or null when your balance spans several currencies (never a cross-currency sum).', security: secured, 'x-required-scopes': ['earnings:read'], responses: { '200': { description: 'OK: { balance (string|null), currency (string|null), balances, statement }' } } } },
      '/network/offers': { get: op('network', 'List all offers (full detail incl. margin; never the postback security code)', ['offers:read']) },
      '/network/publishers': { get: op('network', 'List all publishers', ['publishers:read']) },
      '/network/advertisers': { get: op('network', 'List all advertisers', ['advertisers:read']) },
      '/network/reports/summary': { get: { tags: ['network'], summary: 'Network report summary (30d, incl. margin)', security: secured, 'x-required-scopes': ['reports:read'], responses: { '200': { description: 'OK' } } } },
      '/network/payouts': {
        post: {
          tags: ['network'], summary: 'Trigger a payout run (ONE currency per run, no FX)',
          description:
            'Pays each eligible publisher\'s positive approved balance in ONE currency: a batch + one payout line + one ledger ' +
            'payout debit per publisher, in a single transaction (fx_rate 1, nothing is converted). `currency` omitted → the ' +
            'single currency of the payable balances (the network default when there are none); when they span several ' +
            'currencies the run is refused with 422 and nothing is written — run one payout per currency. Balances in other ' +
            'currencies are untouched and listed in `otherCurrencies`; balances with an invalid currency code are never paid and ' +
            'listed in `skipped`. Concurrent runs are serialised per network; a repeat run pays nothing (balances are zero).',
          security: secured, 'x-required-scopes': ['payouts:write'],
          requestBody: { required: false, content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              publisherIds: { type: 'array', items: { type: 'string', format: 'uuid' }, description: 'Restrict the run to these publishers (all must be yours, else 403).' },
              note: { type: 'string' },
              currency: { type: 'string', pattern: '^[A-Z]{3}$', example: 'EUR', description: 'Pay only balances in this currency.' },
            },
          } } } },
          responses: {
            '201': { description: 'Created: { batchId, currency, total, lines: [{ publisherId, amount }], skipped: [{ publisherId, currency, amount }], otherCurrencies: [{ currency, publishers, total }] }' },
            '403': { description: 'A publisherId is not in your network / wrong audience or scope' },
            '422': { description: 'Invalid `currency`, or payable balances span several currencies and no `currency` was given (details.currencies)' },
          },
        },
      },
    },
  };
}
