// @vitest-environment jsdom
// Toolbar menus and filter chips (UI fixes): the portaled MenuSelect / MenuPopover keyboard and focus
// behaviour, and the ActiveFilterChips accessible names. Only this file runs in jsdom.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuSelect } from '../ui';
import { ActiveFilterChips } from '../ActiveFilterChips';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const OPTIONS = [{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }];

function StatusPick({ onPick }: { onPick?: (v: string) => void }) {
  const [v, setV] = useState('active');
  return (
    <div style={{ overflow: 'hidden' }}>
      <MenuSelect label="Status" value={v} options={OPTIONS} active={v !== ''} onChange={(x) => { setV(x); onPick?.(x); }} />
    </div>
  );
}

describe('MenuSelect (DOM)', () => {
  it('renders the list in <body> (outside any clipping parent), focuses the checked item, ↑/↓ move, Escape returns focus', async () => {
    const user = userEvent.setup();
    render(<StatusPick />);
    const trigger = screen.getByRole('button', { name: 'Status: Active' });
    expect(trigger.getAttribute('data-active')).toBe('true');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');

    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Status: Active' });
    expect(menu.parentElement).toBe(document.body);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Active' }));
    expect(screen.getByRole('menuitemradio', { name: 'Active' }).getAttribute('aria-checked')).toBe('true');

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Paused' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All' }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Paused' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('choosing an item calls onChange with the raw value, closes, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<StatusPick onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: 'Status: Active' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'All' }));
    expect(onPick).toHaveBeenCalledWith('');
    expect(screen.queryByRole('menu')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Status: All' });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('data-active')).toBeNull();
  });

  it('ArrowDown on the closed trigger opens it; an outside pointer-down closes it without moving focus', async () => {
    const user = userEvent.setup();
    render(<><StatusPick /><button type="button">elsewhere</button></>);
    screen.getByRole('button', { name: 'Status: Active' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'elsewhere' }));
  });
});

describe('ActiveFilterChips (DOM)', () => {
  it('each remove button is named "Remove <field>: <value>"; Clear all clears', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    render(<ActiveFilterChips onRemove={onRemove} onClearAll={onClearAll} chips={[
      { key: 'status', label: 'Status', value: 'active', valueLabel: 'Active' },
      { key: 'country', label: 'Country', value: 'IN', valueLabel: 'India', exclude: true },
    ]} />);
    await user.click(screen.getByRole('button', { name: 'Remove Status: Active' }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ key: 'status', value: 'active' }));
    expect(screen.getByRole('button', { name: 'Remove Not Country: India' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
