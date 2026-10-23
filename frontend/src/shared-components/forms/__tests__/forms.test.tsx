// Form primitives (forms master prompt F1): rendered markup via react-dom/server and the pure
// helpers, in the default Node environment. Real clicks, keys and focus: forms.dom.test.tsx (jsdom).
import { describe, it } from 'vitest';
import assert from 'node:assert';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormSection, FormSectionGroup, ExpandAllToggle } from '../FormSection';
import { ChoiceCards, StatusChoice } from '../ChoiceCards';
import { FieldHelpPanel, FIELD_HELP_EMPTY } from '../FieldHelpPanel';
import { FormLayout } from '../FormLayout';
import { FormFooter } from '../FormFooter';
import { UpNextCard } from '../UpNextCard';
import { Stepper } from '../../panels/Stepper';
import { Field } from '../../primitives/ui';
import { helpFromTarget, nextChoiceIndex, regionHasError, requiredInCollapsedDefault } from '../formLogic';

const attr = (html: string, tagStart: string, name: string) => {
  const tag = html.slice(html.indexOf(tagStart), html.indexOf('>', html.indexOf(tagStart)));
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
};

describe('FormSection', () => {
  it('collapsible header is a button wired to a labelled region', () => {
    const html = renderToStaticMarkup(<FormSection id="notes" title="Notes" summary="Description · Internal Notes" collapsible><input defaultValue="x" /></FormSection>);
    const expanded = attr(html, '<button', 'aria-expanded');
    const controls = attr(html, '<button', 'aria-controls');
    const headerId = attr(html, '<button', 'id');
    assert.strictEqual(attr(html, '<button', 'type'), 'button');
    assert.strictEqual(expanded, 'false');
    assert.strictEqual(attr(html, '<div id="' + controls, 'role'), 'region');
    assert.strictEqual(attr(html, '<div id="' + controls, 'aria-labelledby'), headerId);
    assert.match(html, /Description · Internal Notes/);
  });

  it('collapsed content stays mounted (hidden, not unmounted) so values survive', () => {
    const html = renderToStaticMarkup(<FormSection id="s" title="S" collapsible><input name="keep" defaultValue="typed value" /></FormSection>);
    assert.match(html, /name="keep"/);
    assert.match(html, /value="typed value"/);
    assert.match(attr(html, '<div id="s-region', 'class') ?? '', /invisible/);
  });

  it('defaultOpen starts expanded; lazyMount defers content until first open', () => {
    const open = renderToStaticMarkup(<FormSection id="o" title="O" collapsible defaultOpen><p>body</p></FormSection>);
    assert.strictEqual(attr(open, '<button', 'aria-expanded'), 'true');
    const lazy = renderToStaticMarkup(<FormSection id="l" title="L" collapsible lazyMount><p>lazy body</p></FormSection>);
    assert.doesNotMatch(lazy, /lazy body/);
  });

  it('shows "N filled" when given', () => {
    assert.match(renderToStaticMarkup(<FormSection id="f" title="F" collapsible filledCount={2}><i /></FormSection>), /2 filled/);
  });

  it('flags a required control inside a collapsed-by-default section (dev warning rule)', () => {
    const withRequired = { querySelector: (s: string) => (s === '[required]' ? {} : null) };
    const none = { querySelector: () => null };
    assert.strictEqual(requiredInCollapsedDefault({ collapsible: true }, withRequired), true);
    assert.strictEqual(requiredInCollapsedDefault({ collapsible: true, defaultOpen: true }, withRequired), false);
    assert.strictEqual(requiredInCollapsedDefault({ collapsible: false }, withRequired), false);
    assert.strictEqual(requiredInCollapsedDefault({ collapsible: true }, none), false);
  });

  it('opens for a field error (data-field-error / aria-invalid)', () => {
    assert.strictEqual(regionHasError({ querySelector: (s: string) => (s.includes('data-field-error') ? {} : null) }), true);
    assert.strictEqual(regionHasError({ querySelector: () => null }), false);
  });

  it('Expand all appears only for 3+ collapsible sections', () => {
    // Registration happens in effects, which don't run on the server: the toggle renders nothing.
    const html = renderToStaticMarkup(<FormSectionGroup><ExpandAllToggle /><FormSection id="a" title="A" collapsible><i /></FormSection></FormSectionGroup>);
    assert.doesNotMatch(html, /Expand all/);
  });
});

describe('Stepper', () => {
  const STEPS = ['General', 'Tracking & controls', 'Postback configuration', 'Revenue & payout'];
  it('marks the current step with aria-current and checks done steps', () => {
    const html = renderToStaticMarkup(<Stepper steps={STEPS} current={1} labels={['General', 'Tracking', 'Postback', 'Revenue']} />);
    assert.strictEqual((html.match(/aria-current="step"/g) ?? []).length, 1);
    assert.match(html, /aria-current="step"[^>]*>.*?Tracking</);
    assert.match(html, /\(done\)/);
    assert.doesNotMatch(html, /Tracking &amp; controls/); // display label used, value unchanged
  });
  it('renders phase groups with captions, position notes and list numbering', () => {
    const html = renderToStaticMarkup(<Stepper steps={STEPS} current={0} groups={[{ label: 'SETUP', steps: [0, 1, 2] }, { label: 'MONEY', steps: [3] }]} />);
    assert.match(html, /SETUP<span[^>]*>1 of 3</);
    assert.match(html, /MONEY<span[^>]*>1 step</);
    assert.match(html, /<ol start="4"/);
  });
});

describe('ChoiceCards / StatusChoice', () => {
  const OPTS = [{ value: 'active', label: 'Active', tone: 'success' as const }, { value: 'paused', label: 'Paused', tone: 'warning' as const }];
  it('is a radiogroup with one tab stop on the checked option', () => {
    const html = renderToStaticMarkup(<StatusChoice options={OPTS} value="paused" onChange={() => {}} ariaLabel="Status" />);
    assert.match(html, /role="radiogroup"/);
    assert.match(html, /role="radio" aria-checked="true" tabindex="0"[^>]*>.*?Paused/);
    assert.match(html, /role="radio" aria-checked="false" tabindex="-1"[^>]*>.*?Active/);
    assert.match(html, /bg-success-bg/);
  });
  it('neutral tone selects with the accent treatment, not success', () => {
    const html = renderToStaticMarkup(<ChoiceCards options={[{ value: 'percent', label: 'Percent off' }, { value: 'amount', label: 'Amount off' }]} value="percent" onChange={() => {}} />);
    assert.match(html, /bg-accent-subtle/);
    assert.doesNotMatch(html, /bg-success-bg/);
  });
  it('arrow keys / Home / End move the selection (wrapping)', () => {
    assert.strictEqual(nextChoiceIndex('ArrowRight', 0, 3), 1);
    assert.strictEqual(nextChoiceIndex('ArrowDown', 2, 3), 0);
    assert.strictEqual(nextChoiceIndex('ArrowLeft', 0, 3), 2);
    assert.strictEqual(nextChoiceIndex('ArrowUp', 1, 3), 0);
    assert.strictEqual(nextChoiceIndex('Home', 2, 3), 0);
    assert.strictEqual(nextChoiceIndex('End', 0, 3), 2);
    assert.strictEqual(nextChoiceIndex('Tab', 0, 3), null);
  });
});

describe('FieldHelpPanel', () => {
  const field = (label: string, help: string | null) => ({ getAttribute: (n: string) => (n === 'data-help-label' ? label : n === 'data-help' ? help : null) });
  it('reads the focused field label and its existing hint', () => {
    const target = { closest: (s: string) => (s === '[data-help-label]' ? field('Advertiser', 'The company that owns this offer.') : null) };
    assert.deepStrictEqual(helpFromTarget(target), { label: 'Advertiser', help: 'The company that owns this offer.' });
    assert.deepStrictEqual(helpFromTarget({ closest: () => field('Name', null) }), { label: 'Name', help: null });
    assert.strictEqual(helpFromTarget({ closest: () => null }), null);
    assert.strictEqual(helpFromTarget(null), null);
  });
  it('is aria-live and shows the fallback (existing description) when nothing is focused', () => {
    const html = renderToStaticMarkup(<FieldHelpPanel fallback={{ title: 'General details', body: 'Existing step description.' }} />);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /General details/);
    assert.match(html, /Existing step description\./);
    assert.doesNotMatch(renderToStaticMarkup(<FieldHelpPanel />), /Field help/);
  });
});

describe('Field / FormLayout / FormFooter / UpNextCard', () => {
  it('Field keeps the label wiring and exposes help data + an error slot', () => {
    const html = renderToStaticMarkup(<Field label="Offer name *" hint="Shown to partners." error="Please fill out this field."><input className="input" /></Field>);
    const forId = attr(html, '<label', 'for');
    assert.strictEqual(attr(html, '<input', 'id'), forId);
    assert.match(html, /data-help-label="Offer name \*"/);
    assert.match(html, /data-help="Shown to partners\."/);
    assert.strictEqual(attr(html, '<input', 'aria-invalid'), 'true');
    const describedBy = attr(html, '<input', 'aria-describedby');
    assert.match(html, new RegExp(`<p id="${describedBy}" data-field-error=`));
    // existing ids are kept
    assert.strictEqual(attr(renderToStaticMarkup(<Field label="X"><input id="mine" /></Field>), '<label', 'for'), 'mine');
  });
  it('FormLayout centres a wider card without an aside, and adds the aside with help', () => {
    assert.match(renderToStaticMarkup(<FormLayout title="T"><i /></FormLayout>), /max-w-\[880px\]/);
    const withHelp = renderToStaticMarkup(<FormLayout title="T" help={{ fallback: { body: 'b' } }}><i /></FormLayout>);
    assert.match(withHelp, /lg:grid-cols-\[minmax\(0,1fr\)_336px\]/);
    assert.match(withHelp, /<aside/);
  });
  it('FormLayout keeps a wizard’s layout fixed: "aside" reserves the column even when empty, "centered" puts Up next below', () => {
    const reserved = renderToStaticMarkup(<FormLayout title="Email" layout="aside"><i /></FormLayout>);
    assert.match(reserved, /lg:grid-cols-\[minmax\(0,1fr\)_336px\]/);
    assert.match(reserved, /<aside/);
    const centred = renderToStaticMarkup(<FormLayout title="General" layout="centered" upNext={<UpNextCard number={2} name="Address" />}><i /></FormLayout>);
    assert.match(centred, /max-w-\[880px\]/);
    assert.doesNotMatch(centred, /<aside/);
    assert.match(centred, /Step 2: <\/span>Address/);
  });
  it('FieldHelpPanel empty state: step title + the empty-state line', () => {
    const html = renderToStaticMarkup(<FieldHelpPanel fallback={{ title: 'Email', body: FIELD_HELP_EMPTY }} />);
    assert.match(html, /Email/);
    assert.match(html, /Select a field to see its help\./);
  });
  it('FormFooter shows the short label below sm and keeps the full label as the name', () => {
    const html = renderToStaticMarkup(<FormFooter stepText="Step 1 of 9" primary={{ label: 'Next: Tracking & controls', shortLabel: 'Next' }} />);
    assert.match(html, /aria-hidden="true" class="sm:hidden">Next</);
    assert.match(html, /class="sr-only sm:not-sr-only">Next: Tracking &amp; controls</);
    assert.match(html, /Step 1 of 9/);
    assert.doesNotMatch(html, /Unsaved/);
  });
  it('UpNextCard shows the step and an optional Required badge', () => {
    const html = renderToStaticMarkup(<UpNextCard number={2} name="Tracking & controls" required />);
    assert.match(html, /Step 2: <\/span>Tracking &amp; controls/);
    assert.match(html, /Required/);
  });
});
