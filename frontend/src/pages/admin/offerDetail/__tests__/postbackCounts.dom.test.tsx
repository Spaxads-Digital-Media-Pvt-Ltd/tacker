// @vitest-environment jsdom
// Offer › Postbacks: the section header counts come from the tab-level list, which must refresh after
// a section adds / edits / deletes. The API module is mocked — no request leaves the test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// jsdom has no ResizeObserver (the results Table measures its scroller).
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const rows: { id: string; level: string; publisherId: string; url: string; method: string; status: string }[] = [];
const get = vi.fn(async (path: string) => {
  if (path === '/api/offers/o1/postbacks') return [...rows];
  if (path.startsWith('/api/offers/o1/postbacks?level=')) return rows.filter((r) => path.endsWith(`level=${r.level}`));
  return [];
});
const post = vi.fn(async (_path: string, body: Record<string, unknown>) => {
  const row = { id: `pb${rows.length + 1}`, level: String(body.level), publisherId: String(body.publisherId), url: String(body.url), method: 'GET', status: 'active' };
  rows.push(row);
  return row;
});
vi.mock('../../../../lib/api', () => ({
  api: { get: (p: string) => get(p), post: (p: string, b: Record<string, unknown>) => post(p, b), patch: vi.fn(), del: vi.fn(), upload: vi.fn() },
  ApiError: class ApiError extends Error { code = 'x'; },
  NetworkError: class NetworkError extends Error { kind = 'network'; },
}));

const { PostbacksTab } = await import('../ShellTabs');
const { ConfirmProvider } = await import('../../../../shared-components/primitives/ConfirmDialog');

afterEach(() => { cleanup(); rows.length = 0; get.mockClear(); post.mockClear(); });

describe('Offer Postbacks header counts', () => {
  it('refetch the tab-level list after a section adds a postback', async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><PostbacksTab base="/api/offers/o1" pubOptions={[{ value: 'p1', label: 'North Star Traffic' }]} /></ConfirmProvider>);
    const header = await screen.findByRole('button', { name: 'Conversion (0)' });
    const allCalls = () => get.mock.calls.filter(([p]) => p === '/api/offers/o1/postbacks').length;
    expect(allCalls()).toBe(1);

    await user.click(header); // first open mounts the section (lazy)
    const region = document.getElementById(header.getAttribute('aria-controls')!)!;
    await user.click(await within(region).findByRole('button', { name: 'Add' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Partner'), 'p1');
    await user.type(within(dialog).getByLabelText('Postback URL'), 'https://pub.example/pb?cid={click_id}');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(post).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(allCalls()).toBe(2));
    expect(await screen.findByRole('button', { name: 'Conversion (1)' })).toBeTruthy();
    // no new kind of request: only the same list GETs (+ the section's own list) and the one POST
    expect(new Set(get.mock.calls.map(([p]) => p.split('?')[0]))).toEqual(new Set(['/api/offers/o1/postbacks']));
  });
});
