// Failure messages for requests our API couldn't explain itself (lib/errorMessages.ts) — imports the real module.
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { NETWORK_ERROR_MESSAGE, httpFailureMessage, timeoutMessage } from '../errorMessages.ts';

describe('failure messages', () => {
  it('no answer from the server (gateway / dev proxy with the backend down) says so, with the status', () => {
    for (const s of [500, 502, 503, 504]) {
      const m = httpFailureMessage(s, 'Bad Gateway');
      assert.match(m, /isn’t responding/);
      assert.match(m, new RegExp(`HTTP ${s}`));
      assert.match(m, /backend is running/);
    }
  });
  it('other statuses say what they mean, never just the bare status text', () => {
    assert.match(httpFailureMessage(404), /isn’t available/);
    assert.match(httpFailureMessage(413), /too large/);
    assert.match(httpFailureMessage(429), /wait a moment/);
    assert.strictEqual(httpFailureMessage(418, "I'm a teapot"), "The request failed (HTTP 418 I'm a teapot).");
  });
  it('unreachable and too slow read as sentences', () => {
    assert.match(NETWORK_ERROR_MESSAGE, /Can’t reach the server/);
    assert.strictEqual(timeoutMessage(30_000), 'The server took longer than 30 seconds to answer. Please try again.');
  });
});
