// Click Report filter modal logic (lib/clickReportFilters.ts) — imports the real module.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CLICK_FIELDS, DEFAULT_FIELDS, EMPTY_CLICK_FILTERS, MAX_CLICK_IDS, TABLE_ORDER, appliedFilterCount, chipValues,
  clickIdsError, draftErrors, draftFromApplied, exportRecord, fieldByKey, fieldsFromUrl, filtersFromDraft,
  filtersFromUrl, ipError, isIpAddress, isSelectable, parseClickIds, searchFields, selectAllState, setAllFields,
  toApiParams, toggleField, visibleColumns, withoutChip, writeFieldsToUrl, writeFiltersToUrl, type ClickFilters,
} from '../clickReportFilters.ts';

const ID1 = 'a'.repeat(32);
const ID2 = '0123456789abcdef0123456789abcdef';
const UUID = '7f23c4cc-19f7-4653-8f3f-7d0dc7d4cae6';
const OPTS = { conversionStatuses: ['any', 'approved', 'pending', 'rejected', 'none'], devices: ['desktop', 'mobile', 'tablet'] };

describe('Click IDs', () => {
  it('trims, drops empty entries, de-duplicates and lower-cases', () => {
    assert.deepStrictEqual(parseClickIds(` ${ID1} ,, ${ID2.toUpperCase()},${ID1}, `), { ids: [ID1, ID2], invalid: [] });
  });
  it('accepts commas or new lines', () => {
    assert.deepStrictEqual(parseClickIds(`${ID1}\n${ID2}`).ids, [ID1, ID2]);
  });
  it('reports malformed entries and never returns them as ids', () => {
    const p = parseClickIds(`${ID1}, nope, ${'g'.repeat(32)}`);
    assert.deepStrictEqual(p.ids, [ID1]);
    assert.deepStrictEqual(p.invalid, ['nope', 'g'.repeat(32)]);
    assert.match(clickIdsError(`${ID1}, nope`)!, /Not a click ID: nope/);
  });
  it(`allows at most ${MAX_CLICK_IDS} ids`, () => {
    const many = Array.from({ length: MAX_CLICK_IDS + 1 }, (_, i) => i.toString(16).padStart(32, '0')).join(',');
    assert.match(clickIdsError(many)!, /At most 100/);
    assert.strictEqual(clickIdsError(''), null);
  });
});

describe('IP address', () => {
  it('accepts IPv4 and IPv6, rejects anything else; empty is fine', () => {
    for (const ok of ['10.0.0.1', '255.255.255.255', '2001:db8::1', '::1']) assert.ok(isIpAddress(ok), ok);
    for (const bad of ['10.0.0', '256.1.1.1', 'abc', '10.0.0.1/32', '1.2.3.4 5']) assert.ok(!isIpAddress(bad), bad);
    assert.strictEqual(ipError(''), null);
    assert.match(ipError('nope')!, /valid IPv4 or IPv6/);
  });
});

describe('draft vs applied', () => {
  const applied: ClickFilters = { ...EMPTY_CLICK_FILTERS, offer: UUID, clickIds: [ID1], ip: '10.0.0.1', visibility: 'unique' };
  it('opening the modal shows the applied values (and editing the draft never touches them)', () => {
    const d = draftFromApplied(applied, 'Europe/Paris', ['createdDate', 'clickId']);
    assert.strictEqual(d.filters.offer, UUID);
    assert.strictEqual(d.clickIdsText, ID1);
    assert.strictEqual(d.ipText, '10.0.0.1');
    assert.strictEqual(d.timezone, 'Europe/Paris');
    assert.deepStrictEqual(d.fields, ['createdDate', 'clickId']);
    d.filters.clickIds.push(ID2); d.filters.offer = '';
    assert.deepStrictEqual(applied.clickIds, [ID1]); // Cancel = drop the draft; applied is unchanged
    assert.strictEqual(applied.offer, UUID);
  });
  it('Apply commits the parsed text inputs', () => {
    const d = { ...draftFromApplied(applied, '', DEFAULT_FIELDS), clickIdsText: `${ID2}, ${ID1}`, ipText: ' 2001:db8::1 ' };
    assert.deepStrictEqual(draftErrors(d), {});
    const next = filtersFromDraft(d);
    assert.deepStrictEqual(next.clickIds, [ID2, ID1]);
    assert.strictEqual(next.ip, '2001:db8::1');
  });
  it('invalid inputs or no selectable field block Apply', () => {
    const d = { ...draftFromApplied(applied, '', ['g1']), clickIdsText: 'x', ipText: '1.2.3' };
    const e = draftErrors(d);
    assert.ok(e.clickIds && e.ip && e.fields);
  });
});

describe('applied-filter count', () => {
  it('is 0 for defaults, counts each non-default data filter once, ignores dates/timezone/columns', () => {
    assert.strictEqual(appliedFilterCount(EMPTY_CLICK_FILTERS), 0);
    const f: ClickFilters = { offer: UUID, partner: UUID, advertiser: UUID, smartLink: UUID, country: 'US', device: 'mobile', conversionStatus: 'approved', clickIds: [ID1, ID2], ip: '10.0.0.1', sourceId: 's', fbclid: 'f', gclid: 'g', visibility: 'duplicate' };
    assert.strictEqual(appliedFilterCount(f), 13);
    assert.strictEqual(appliedFilterCount({ ...EMPTY_CLICK_FILTERS, clickIds: [ID1, ID2] }), 1);
  });
});

describe('API params', () => {
  it('sends exactly the applied filters with the API names; defaults send nothing', () => {
    assert.deepStrictEqual(Object.entries(toApiParams(EMPTY_CLICK_FILTERS)).filter(([, v]) => v !== undefined), []);
    const p = toApiParams({ ...EMPTY_CLICK_FILTERS, offer: UUID, partner: UUID, device: 'mobile', clickIds: [ID1, ID2], ip: '10.0.0.1', visibility: 'unique', conversionStatus: 'none' });
    assert.deepStrictEqual(p, {
      offerId: UUID, publisherId: UUID, advertiserId: undefined, smartLinkId: undefined, country: undefined,
      device: 'mobile', conversionStatus: 'none', clickIds: `${ID1},${ID2}`, ip: '10.0.0.1',
      sourceId: undefined, fbclid: undefined, gclid: undefined, isUnique: 'true',
    });
    assert.strictEqual(toApiParams({ ...EMPTY_CLICK_FILTERS, visibility: 'duplicate' }).isUnique, 'false');
  });
  it('click-URL filters (Source / FB Click ID / Google Click ID) go as sourceId / fbclid / gclid', () => {
    const p = toApiParams({ ...EMPTY_CLICK_FILTERS, sourceId: 'push-12', fbclid: 'IwAR1', gclid: 'Cj0K' });
    assert.deepStrictEqual([p.sourceId, p.fbclid, p.gclid], ['push-12', 'IwAR1', 'Cj0K']);
    assert.strictEqual(appliedFilterCount({ ...EMPTY_CLICK_FILTERS, sourceId: 'a', gclid: 'b' }), 2);
    assert.deepStrictEqual(chipValues({ ...EMPTY_CLICK_FILTERS, fbclid: 'IwAR1' }), { fbclid: ['IwAR1'] });
    assert.deepStrictEqual(withoutChip({ ...EMPTY_CLICK_FILTERS, fbclid: 'IwAR1', sourceId: 's' }, 'fbclid', 'IwAR1'), { ...EMPTY_CLICK_FILTERS, sourceId: 's' });
  });
  it('click-URL filter drafts are trimmed on Apply and over-long values are rejected', () => {
    const d = draftFromApplied(EMPTY_CLICK_FILTERS, '', DEFAULT_FIELDS);
    d.filters = { ...d.filters, sourceId: '  push-12 ', gclid: 'x'.repeat(501) };
    assert.deepStrictEqual(Object.keys(draftErrors(d)), ['gclid']);
    d.filters.gclid = ' Cj0K ';
    assert.deepStrictEqual(draftErrors(d), {});
    const f = filtersFromDraft(d);
    assert.deepStrictEqual([f.sourceId, f.gclid], ['push-12', 'Cj0K']);
  });
});

describe('URL round-trip (reload / shared link)', () => {
  it('filters and selected fields survive serialise → parse', () => {
    const f: ClickFilters = { ...EMPTY_CLICK_FILTERS, offer: UUID, country: 'DE', device: 'tablet', conversionStatus: 'pending', clickIds: [ID1], ip: '10.1.2.3', sourceId: 'push, native', gclid: 'Cj0K', visibility: 'duplicate' };
    const next = new URLSearchParams();
    writeFiltersToUrl(next, f);
    writeFieldsToUrl(next, ['clickId', 'createdDate', 'ip']);
    assert.deepStrictEqual(filtersFromUrl(next, OPTS), f);
    assert.deepStrictEqual(fieldsFromUrl(next), ['createdDate', 'clickId', 'ip']);
  });
  it('malformed values are dropped, not sent', () => {
    const sp = new URLSearchParams({ offerId: 'x', country: 'Germany', device: 'fridge', conversionStatus: 'paid', clickIds: `${ID1},bad`, ip: '1.2', isUnique: 'maybe', cols: 'g1,nope' });
    assert.deepStrictEqual(filtersFromUrl(sp, OPTS), { ...EMPTY_CLICK_FILTERS, clickIds: [ID1] });
    assert.strictEqual(fieldsFromUrl(sp), null); // only unusable keys → defaults
  });
  it('the default field selection writes no `cols` param', () => {
    const next = new URLSearchParams();
    writeFieldsToUrl(next, DEFAULT_FIELDS);
    assert.strictEqual(next.has('cols'), false);
  });
});

describe('Click Report Fields', () => {
  it('lists every reference field; only real ones are selectable', () => {
    for (const l of ['Click ID', 'Offer ID', 'Offer Title', 'Partner Company', 'G1', 'G8', 'GAID', 'IDFA', 'Final URL', 'Click URL', 'Created Date']) {
      assert.ok(CLICK_FIELDS.some((f) => f.label === l), l);
    }
    for (const k of ['g1', 'gaid', 'idfa', 'landingPageId', 'proxy', 'finalUrl', 'advertiserCompany']) assert.strictEqual(isSelectable(k), false, k);
    // Captured from the click URL and stored on the click (clicks.source_id / fbclid / gclid).
    for (const k of ['source', 'fbClickId', 'googleClickId']) assert.strictEqual(isSelectable(k), true, k);
    // Every field still disabled says what is missing — never a generic "not tracked".
    for (const f of CLICK_FIELDS.filter((x) => x.support === 'unavailable')) assert.ok(f.hint && f.hint.length > 30, f.key);
    for (const k of DEFAULT_FIELDS) assert.ok(isSelectable(k), k);
  });
  it('search filters the list case-insensitively', () => {
    assert.deepStrictEqual(searchFields('click id').map((f) => f.label), ['Click ID', 'FB Click ID', 'Google Click ID']);
    assert.strictEqual(searchFields('').length, CLICK_FIELDS.length);
  });
  it('Select All works on the searched fields only, skips untracked ones, and reports some/all/none', () => {
    const ids = searchFields('id'); // Click ID, Offer ID, Partner ID, Smart Link ID, Advertiser ID, … GAID (untracked) …
    assert.strictEqual(selectAllState([], ids), 'none');
    const on = setAllFields(['createdDate'], ids, true);
    assert.ok(on.includes('clickId') && on.includes('offerId') && on.includes('createdDate'));
    assert.ok(!on.includes('gaid') && !on.includes('landingPageId'));
    assert.strictEqual(selectAllState(on, ids), 'all');
    assert.strictEqual(selectAllState(['clickId'], ids), 'some');
    const off = setAllFields(on, ids, false);
    assert.deepStrictEqual(off, ['createdDate']); // fields outside the search stay selected
  });
  it('headers, cells and exports share one ordered column list (untracked fields never appear)', () => {
    const cols = visibleColumns(['ip', 'g1', 'clickId', 'createdDate', 'converted']);
    assert.deepStrictEqual(cols, ['createdDate', 'converted', 'clickId', 'ip']);
    assert.deepStrictEqual(cols, TABLE_ORDER.filter((k) => cols.includes(k)));
    const rec = exportRecord(cols, (k) => `v:${k}`);
    assert.deepStrictEqual(Object.keys(rec), cols.map((k) => fieldByKey(k)!.label));
    assert.deepStrictEqual(Object.values(rec), cols.map((k) => `v:${k}`));
  });
});

describe('field checkbox toggling (modal → Apply)', () => {
  it('a checkbox (or its label) turns a tracked field on and off', () => {
    for (const key of ['partnerId', 'ip', 'country', 'payout', 'revenue', 'createdDate']) {
      const on = toggleField(['clickId'], key, true);
      assert.ok(on.includes(key) && on.includes('clickId'), `${key} on`);
      assert.deepStrictEqual(toggleField(on, key, false), ['clickId'], `${key} off`);
    }
  });
  it('untracked / unknown fields never change the selection, even if the DOM reports checked', () => {
    for (const key of ['gaid', 'g1', 'advertiserCompany', 'proxy', 'nope']) {
      assert.deepStrictEqual(toggleField(['clickId', 'ip'], key, true), ['clickId', 'ip'], key);
    }
  });
  it('Apply commits the draft selection; Cancel (dropping the draft) keeps the applied one', () => {
    const applied = [...DEFAULT_FIELDS];
    const draft = draftFromApplied(EMPTY_CLICK_FILTERS, '', applied);
    draft.fields = toggleField(draft.fields, 'payout', true);
    draft.fields = toggleField(draft.fields, 'country', false);
    assert.deepStrictEqual(draftErrors(draft), {});
    const committed = visibleColumns(draft.fields); // what Apply hands the table / export
    assert.ok(committed.includes('payout') && !committed.includes('country'));
    assert.ok(applied.includes('country') && !applied.includes('payout')); // applied list untouched until Apply
  });
});

describe('chips', () => {
  it('one chip per applied filter (one per click ID); removing a chip resets just that filter', () => {
    const f: ClickFilters = { ...EMPTY_CLICK_FILTERS, offer: UUID, clickIds: [ID1, ID2], visibility: 'unique', ip: '10.0.0.1' };
    assert.deepStrictEqual(chipValues(f), { offer: [UUID], ip: ['10.0.0.1'], clickIds: [ID1, ID2], visibility: ['unique'] });
    assert.deepStrictEqual(withoutChip(f, 'clickIds', ID1).clickIds, [ID2]);
    assert.strictEqual(withoutChip(f, 'visibility', 'unique').visibility, 'all');
    assert.strictEqual(withoutChip(f, 'offer', UUID).offer, '');
    assert.deepStrictEqual(chipValues(EMPTY_CLICK_FILTERS), {});
  });
});
