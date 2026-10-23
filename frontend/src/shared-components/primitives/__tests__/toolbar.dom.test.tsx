// @vitest-environment jsdom
// Inline filter chips: the list FilterToolbar and the report ResultsBar keep chips in the toolbar row
// (after Filters / the title, before the actions) and add nothing when no filter is active.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterToolbar } from '../../../pages/admin/PagedListControls';
import { ResultsBar } from '../ReportLayout';
import { ActiveFilterChips, type FilterChip } from '../ActiveFilterChips';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const CHIPS: FilterChip[] = [
  { key: 'status', label: 'Status', value: 'active', valueLabel: 'Active' },
  { key: 'country', label: 'Country', value: 'IN', valueLabel: 'India' },
];

describe('FilterToolbar (DOM)', () => {
  it('tab / DOM order is controls → chips → Clear all → actions; the same handlers fire', async () => {
    const user = userEvent.setup();
    const onRemoveChip = vi.fn();
    const onClearAll = vi.fn();
    render(
      <FilterToolbar chips={CHIPS} onRemoveChip={onRemoveChip} onClearAll={onClearAll}
        actions={<><a href="/new">+ Offer</a><button type="button">Table actions</button></>}>
        <input aria-label="Search" />
        <button type="button">Filters · 2</button>
      </FilterToolbar>,
    );
    const order = screen.getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label'));
    expect(order).toEqual(['Filters · 2', 'Remove Status: Active', 'Remove Country: India', 'Clear all', 'Table actions']);
    // chips sit in the same wrapping row as the controls (their wrapper is display: contents)
    const row = screen.getByLabelText('Search').parentElement!;
    expect(within(row).getByRole('button', { name: 'Remove Status: Active' })).toBeTruthy();
    expect(row.querySelector('[aria-label="Active filters"]')!.className).toBe('contents');
    // the actions are a separate column, not inside the wrapping row
    expect(row.contains(screen.getByRole('link', { name: '+ Offer' }))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Remove Country: India' }));
    expect(onRemoveChip).toHaveBeenCalledWith(CHIPS[1]);
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('`lead` (the search) comes first in tab order and is kept out of the wrapping controls row', () => {
    render(
      <FilterToolbar lead={<input aria-label="Search" />} chips={CHIPS.slice(0, 1)} onRemoveChip={() => {}} onClearAll={() => {}}
        actions={<button type="button">Table actions</button>}>
        <button type="button">Status: All</button>
        <button type="button">Filters · 1</button>
      </FilterToolbar>,
    );
    const focusables = [...document.querySelectorAll('input, button')].map((e) => e.getAttribute('aria-label') || e.textContent);
    expect(focusables).toEqual(['Search', 'Status: All', 'Filters · 1', 'Remove Status: Active', 'Clear all', 'Table actions']);
    const leadCell = screen.getByLabelText('Search').parentElement!;
    expect(leadCell.className).toMatch(/\bsm:contents\b/);
    const row = screen.getByRole('button', { name: 'Filters · 1' }).parentElement!;
    expect(row).not.toBe(leadCell);
    expect(row.className).toMatch(/\bcol-span-2\b/);
    expect(within(row).getByRole('button', { name: 'Clear all' })).toBeTruthy();
  });

  it('with no active filters it renders no chip group at all', () => {
    render(<FilterToolbar chips={[]} onRemoveChip={() => {}} onClearAll={() => {}} actions={<a href="/new">+ Offer</a>}><input aria-label="Search" /></FilterToolbar>);
    expect(document.querySelector('[aria-label="Active filters"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });
});

describe('ResultsBar (DOM)', () => {
  it('renders the chips inline after the title (sm+) and in a row after the actions (below sm) — one displayed at a time', () => {
    render(
      <ResultsBar title="Detailed Report" actions={<button type="button">Table Actions</button>}>
        <p>note</p>
        <ActiveFilterChips chips={CHIPS} onRemove={() => {}} onClearAll={() => {}} />
      </ResultsBar>,
    );
    const groups = [...document.querySelectorAll('[aria-label="Active filters"]')];
    expect(groups).toHaveLength(2);
    groups.forEach((g) => expect(g.className).toBe('contents'));
    expect(groups[0]!.parentElement!.className).toBe('hidden sm:contents');
    expect(groups[1]!.parentElement!.className).toMatch(/\bsm:hidden\b/);
    // the non-chip children stay in the left column
    expect(screen.getByText('note')).toBeTruthy();
  });

  it('adds nothing when no filter is active', () => {
    const { container } = render(
      <ResultsBar title="Detailed Report" actions={<button type="button">Table Actions</button>}>
        <ActiveFilterChips chips={[]} onRemove={() => {}} onClearAll={() => {}} />
      </ResultsBar>,
    );
    expect(container.querySelector('[aria-label="Active filters"]')).toBeNull();
    expect(container.querySelector('.sm\\:hidden')).toBeNull();
  });
});
