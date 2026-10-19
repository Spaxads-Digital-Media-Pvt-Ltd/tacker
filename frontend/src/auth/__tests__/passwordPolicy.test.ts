import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { passwordProblem, PASSWORD_MIN } from '../passwordPolicy';

describe('passwordProblem (matches the API: 12+ characters)', () => {
  it('rejects short passwords, counting trimmed length like the server', () => {
    assert.equal(PASSWORD_MIN, 12);
    assert.match(passwordProblem('short', 'short') ?? '', /at least 12/);
    assert.match(passwordProblem('   eleven11   ', '   eleven11   ') ?? '', /at least 12/);
  });
  it('rejects a mismatched confirmation', () => {
    assert.match(passwordProblem('long-enough-password', 'long-enough-passw0rd') ?? '', /don't match/);
  });
  it('accepts a long, confirmed password', () => {
    assert.equal(passwordProblem('long-enough-password', 'long-enough-password'), null);
  });
});
