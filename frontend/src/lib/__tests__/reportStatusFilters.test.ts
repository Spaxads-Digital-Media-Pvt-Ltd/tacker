// Click Report "Conversion Status" and Click → Conversion Time status filters (lib/reportStatusFilters.ts).
import { describe, it } from 'vitest';
import assert from 'node:assert';
import {
  CONVERSION_STATUS_OPTIONS, CONVERSION_STATUS_PARAM, C2C_STATUS_OPTIONS, C2C_STATUS_PARAM, C2C_DEFAULT_STATUS,
  readStatusParam, statusParamValue,
} from '../reportStatusFilters.ts';

const sp = (q: string) => new URLSearchParams(q);

describe('Click Report conversionStatus', () => {
  it('offers any / approved / pending / rejected / none, sent as `conversionStatus`', () => {
    assert.strictEqual(CONVERSION_STATUS_PARAM, 'conversionStatus');
    assert.deepStrictEqual(CONVERSION_STATUS_OPTIONS.map((o) => o.value), ['any', 'approved', 'pending', 'rejected', 'none']);
    assert.strictEqual(CONVERSION_STATUS_OPTIONS.find((o) => o.value === 'none')?.label, 'Not converted');
    assert.strictEqual(CONVERSION_STATUS_OPTIONS.find((o) => o.value === 'any')?.label, 'Any conversion');
  });
  it('round-trips through the URL; unknown or empty values are dropped', () => {
    for (const o of CONVERSION_STATUS_OPTIONS) {
      const next = new URLSearchParams();
      next.set(CONVERSION_STATUS_PARAM, statusParamValue([o.value], CONVERSION_STATUS_OPTIONS)!);
      assert.strictEqual(readStatusParam(next, CONVERSION_STATUS_PARAM, CONVERSION_STATUS_OPTIONS), o.value);
    }
    assert.strictEqual(readStatusParam(sp('conversionStatus=APPROVED'), CONVERSION_STATUS_PARAM, CONVERSION_STATUS_OPTIONS), 'approved');
    assert.strictEqual(readStatusParam(sp('conversionStatus=bogus'), CONVERSION_STATUS_PARAM, CONVERSION_STATUS_OPTIONS), undefined);
    assert.strictEqual(readStatusParam(sp('conversionStatus='), CONVERSION_STATUS_PARAM, CONVERSION_STATUS_OPTIONS), undefined);
    assert.strictEqual(readStatusParam(sp(''), CONVERSION_STATUS_PARAM, CONVERSION_STATUS_OPTIONS), undefined);
  });
  it('no selection → no param (every click, as before)', () => {
    assert.strictEqual(statusParamValue(undefined, CONVERSION_STATUS_OPTIONS), undefined);
    assert.strictEqual(statusParamValue([], CONVERSION_STATUS_OPTIONS), undefined);
    assert.strictEqual(statusParamValue(['nope'], CONVERSION_STATUS_OPTIONS), undefined);
    assert.strictEqual(statusParamValue(['pending'], CONVERSION_STATUS_OPTIONS), 'pending');
  });
});

describe('Click → Conversion Time status', () => {
  it('is sent as `status`; approved is the (labelled) default; all = every status', () => {
    assert.strictEqual(C2C_STATUS_PARAM, 'status');
    assert.strictEqual(C2C_DEFAULT_STATUS, 'approved');
    assert.deepStrictEqual(C2C_STATUS_OPTIONS.map((o) => o.value), ['approved', 'pending', 'rejected', 'all']);
    assert.strictEqual(C2C_STATUS_OPTIONS.find((o) => o.value === C2C_DEFAULT_STATUS)?.label, 'Approved (default)');
    assert.strictEqual(C2C_STATUS_OPTIONS.find((o) => o.value === 'all')?.label, 'All statuses');
  });
  it('reads only known values from the URL; nothing selected sends no param (→ approved)', () => {
    assert.strictEqual(readStatusParam(sp('status=all'), C2C_STATUS_PARAM, C2C_STATUS_OPTIONS), 'all');
    assert.strictEqual(readStatusParam(sp('status=Rejected'), C2C_STATUS_PARAM, C2C_STATUS_OPTIONS), 'rejected');
    assert.strictEqual(readStatusParam(sp('status=none'), C2C_STATUS_PARAM, C2C_STATUS_OPTIONS), undefined);
    assert.strictEqual(statusParamValue(undefined, C2C_STATUS_OPTIONS), undefined);
  });
});
