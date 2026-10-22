import { describe, it } from 'vitest';
import assert from 'node:assert';
import { hexToTriplet } from '../hostBrand.ts';

describe('white-label colour', () => {
  it('a hex colour becomes the theme variables’ RGB triplet', () => {
    assert.equal(hexToTriplet('#1E3557'), '30 53 87');
    assert.equal(hexToTriplet('#ffffff'), '255 255 255');
    assert.equal(hexToTriplet('blue'), null);
    assert.equal(hexToTriplet(null), null);
  });
});
