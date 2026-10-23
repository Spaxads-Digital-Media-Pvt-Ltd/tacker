// @vitest-environment jsdom
// Interaction tests for the form primitives (F1b). Only this file runs in jsdom; the rest of the
// suite keeps the default Node environment.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormSection } from '../FormSection';
import { ChoiceCards } from '../ChoiceCards';
import { FormLayout } from '../FormLayout';
import { Accordion } from '../../panels/Accordion';
import { Stepper } from '../../panels/Stepper';
import { ToggleRow } from '../../primitives/ToggleRow';
import { Field } from '../../primitives/ui';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('FormSection (DOM)', () => {
  it('click, Enter and Space toggle it; aria-expanded / aria-controls follow', async () => {
    const user = userEvent.setup();
    render(<FormSection id="opt" title="Optional details" collapsible><input aria-label="Preview URL" /></FormSection>);
    const header = screen.getByRole('button', { name: /Optional details/ });
    const region = document.getElementById(header.getAttribute('aria-controls')!)!;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-labelledby')).toBe(header.id);
    expect(header.getAttribute('aria-expanded')).toBe('false');

    await user.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(region.className).toMatch(/\bvisible\b/);

    header.focus();
    await user.keyboard('{Enter}');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(region.className).toMatch(/\binvisible\b/);
    await user.keyboard(' ');
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapsing keeps the content mounted with what was typed', async () => {
    const user = userEvent.setup();
    render(<FormSection id="opt" title="Optional details" collapsible defaultOpen><input aria-label="Product ID" /></FormSection>);
    await user.type(screen.getByLabelText('Product ID'), 'SKU-42');
    await user.click(screen.getByRole('button', { name: /Optional details/ }));
    const input = screen.getByLabelText<HTMLInputElement>('Product ID');
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe('SKU-42');
    await user.click(screen.getByRole('button', { name: /Optional details/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Product ID').value).toBe('SKU-42');
  });

  it('an invalid control opens its collapsed section before the browser focuses it; submit is blocked', async () => {
    const user = userEvent.setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <FormSection id="opt" title="Optional details" collapsible><input aria-label="App identifier" required /></FormSection>
        <button type="submit">Next</button>
      </form>,
    );
    // The dev guard flags a required control inside a collapsed-by-default section.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/collapsed by default but contains a required control/));

    const input = screen.getByLabelText('App identifier');
    const header = screen.getByRole('button', { name: /Optional details/ });
    const region = document.getElementById(header.getAttribute('aria-controls')!)!;
    // Record the section state at the moment the browser would try to focus the control: after the
    // invalid event has been dispatched (the section's capture handler has already run).
    const atInvalid: string[] = [];
    input.addEventListener('invalid', () => {
      atInvalid.push(header.getAttribute('aria-expanded')!, region.className.includes('invisible') ? 'hidden' : 'shown');
      input.focus(); // what the browser does next (jsdom doesn't focus on its own)
    });

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(atInvalid).toEqual(['true', 'shown']);
    expect(document.activeElement).toBe(input);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a field error (Field `error`) inside a collapsed section opens it', () => {
    const { rerender } = render(
      <FormSection id="opt" title="Optional details" collapsible><Field label="Preview URL"><input className="input" /></Field></FormSection>,
    );
    const header = screen.getByRole('button', { name: /Optional details/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    rerender(
      <FormSection id="opt" title="Optional details" collapsible><Field label="Preview URL" error="Enter a URL."><input className="input" /></Field></FormSection>,
    );
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('Accordion lazyMount (DOM)', () => {
  // Stands in for a CollectionTab: it fetches once, on mount.
  function Fetches({ onFetch }: { onFetch: () => void }) {
    useEffect(() => { onFetch(); }, [onFetch]);
    return <p>rows</p>;
  }

  it('a closed section sends no request until first opened, then stays mounted', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    render(<Accordion title="Custom Caps Settings" count={0}><Fetches onFetch={fetchSpy} /></Accordion>);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('rows')).toBeNull();

    const header = screen.getByRole('button', { name: /Custom Caps Settings \(0\)/ });
    await user.click(header);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await user.click(header); // close
    await user.click(header); // reopen
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('rows').isConnected).toBe(true);
  });

  it('a defaultOpen section fetches immediately', () => {
    const fetchSpy = vi.fn();
    render(<Accordion title="Conversion" defaultOpen><Fetches onFetch={fetchSpy} /></Accordion>);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('ChoiceCards (DOM)', () => {
  const OPTS = [{ value: 'percent', label: 'Percent off' }, { value: 'amount', label: 'Amount off' }, { value: 'free', label: 'Free shipping' }];
  function Harness({ onChange }: { onChange: (v: string) => void }) {
    const [v, setV] = useState('percent');
    return <ChoiceCards options={OPTS} value={v} onChange={(n) => { setV(n); onChange(n); }} ariaLabel="Discount type" />;
  }
  const tabIndexes = () => screen.getAllByRole('radio').map((r) => r.getAttribute('tabindex'));

  it('arrow keys, Home and End move focus and selection with one roving tab stop', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(tabIndexes()).toEqual(['0', '-1', '-1']);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Percent off' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Amount off' }));
    expect(screen.getByRole('radio', { name: 'Amount off' }).getAttribute('aria-checked')).toBe('true');
    expect(tabIndexes()).toEqual(['-1', '0', '-1']);

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Free shipping' }));
    await user.keyboard('{ArrowDown}'); // wraps
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Percent off' }));
    await user.keyboard('{ArrowLeft}'); // wraps back
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Free shipping' }));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Percent off' }));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['amount', 'free', 'percent', 'free', 'percent']);

    // Tab leaves the group in one step.
    await user.tab();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('FieldHelpPanel (DOM)', () => {
  it('shows the focused field’s label and existing hint, and falls back when focus leaves', async () => {
    const user = userEvent.setup();
    render(
      <FormLayout title="General" help={{ fallback: { title: 'General', body: 'Step description.' } }}>
        <Field label="Advertiser *" hint="The company that owns this offer."><select className="input"><option>Acme</option></select></Field>
        <Field label="Offer name *"><input className="input" /></Field>
      </FormLayout>,
    );
    const aside = document.querySelector('aside')!;
    const panel = within(aside);
    expect(panel.getByRole('heading', { name: 'General' })).toBeTruthy();
    expect(aside.querySelector('[aria-live="polite"]')).not.toBeNull();

    await user.click(screen.getByLabelText('Advertiser *'));
    expect(panel.getByRole('heading', { name: 'Advertiser *' })).toBeTruthy();
    expect(panel.getByText('The company that owns this offer.')).toBeTruthy();

    await user.click(screen.getByLabelText('Offer name *')); // no hint → title only
    expect(panel.getByRole('heading', { name: 'Offer name *' })).toBeTruthy();
    expect(panel.queryByText('The company that owns this offer.')).toBeNull();

    await user.click(document.body);
    expect(panel.getByRole('heading', { name: 'General' })).toBeTruthy();
  });
});

describe('Stepper (DOM)', () => {
  const STEPS = ['General', 'Tracking & controls', 'Postback configuration'];

  it('moves aria-current with the current step', () => {
    const { rerender } = render(<Stepper steps={STEPS} current={0} />);
    const current = () => document.querySelectorAll('[aria-current="step"]');
    expect(current()).toHaveLength(1);
    expect(current()[0]!.textContent).toContain('General');
    rerender(<Stepper steps={STEPS} current={2} />);
    expect(current()).toHaveLength(1);
    expect(current()[0]!.textContent).toContain('Postback configuration');
    expect(screen.getAllByText('(done)', { exact: false })).toHaveLength(2);
  });

  it('the chip row is a labelled keyboard stop only while it scrolls', () => {
    const { unmount } = render(<Stepper steps={STEPS} current={0} />);
    const row = screen.getByRole('group', { name: 'Steps' });
    expect(row.hasAttribute('tabindex')).toBe(false); // jsdom: no overflow
    unmount();

    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(358);
    render(<Stepper steps={STEPS} current={0} />);
    expect(screen.getByRole('group', { name: 'Steps' }).getAttribute('tabindex')).toBe('0');
    expect(screen.queryAllByRole('link')).toHaveLength(0); // steps stay non-clickable
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('pages that already jumped between steps pass onStepClick: chips become buttons calling it', async () => {
    const user = userEvent.setup();
    const onStepClick = vi.fn();
    render(<Stepper steps={['General', 'Settings']} current={0} onStepClick={onStepClick} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute('aria-current')).toBe('step');
    expect(buttons[0]!.getAttribute('type')).toBe('button');
    await user.click(screen.getByRole('button', { name: /Settings/ }));
    expect(onStepClick).toHaveBeenCalledWith(1);
  });
});

describe('ToggleRow (DOM)', () => {
  it('switches and uses the surface knob only when on', async () => {
    const user = userEvent.setup();
    function Harness() { const [on, setOn] = useState(false); return <ToggleRow label="Private offer" checked={on} onChange={setOn} />; }
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Private offer' });
    const knob = () => sw.querySelector('span')!.className;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(knob()).toMatch(/bg-on-accent/);
    await user.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(knob()).toMatch(/bg-surface/);
    expect(knob()).not.toMatch(/bg-on-accent/);
  });
});
