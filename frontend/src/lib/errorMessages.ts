/**
 * What to tell a person when a request failed before our API could explain it in its own error envelope
 * ({ ok: false, error: { message } } — that message is always shown as is): the server couldn't be
 * reached, took too long, or something in between (a proxy / gateway) answered instead.
 * Pure — no React / DOM (lib/__tests__/errorMessages.test.ts).
 */

export const NETWORK_ERROR_MESSAGE = 'Can’t reach the server. Check your internet connection — or, on a local setup, that the backend is running.';

export const timeoutMessage = (ms: number): string =>
  `The server took longer than ${Math.round(ms / 1000)} seconds to answer. Please try again.`;

/** A failed response without our error envelope: a gateway / dev proxy answered, or the backend is down. */
export function httpFailureMessage(status: number, statusText = ''): string {
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return `The server isn’t responding right now (HTTP ${status}). On a local setup, check that the backend is running.`;
  }
  if (status === 404) return 'That isn’t available on the server (HTTP 404).';
  if (status === 413) return 'That’s too large to send (HTTP 413).';
  if (status === 429) return 'Too many requests — wait a moment and try again (HTTP 429).';
  return `The request failed (HTTP ${status}${statusText ? ` ${statusText}` : ''}).`;
}
