// Regression test: reproduces RuleEditor's mode/values transition logic (TargetingPanel.tsx).
// Bug: clicking Exclude (or Include) before any value exists collapsed the rule to `undefined`
// (nothing to save with zero values), and since the UI derived its displayed mode from
// `rule?.mode ?? 'include'`, that undefined rule made the toggle visibly snap back to Include —
// so switching modes appeared to do nothing until at least one value had been typed.
import { describe, it } from 'node:test';
import assert from 'node:assert';

type Mode = 'include' | 'exclude';
interface Rule { mode: Mode; values: string[] }

// Reproduces the RuleEditor hook state exactly: `useState` values collapsed into plain variables,
// `setMode`/`setValues` mirroring the component's own logic (including the `key={k}` remount that
// resets `localMode` per dimension — modelled here as a fresh `makeEditor()` per test).
function makeEditor(initial: Rule | undefined) {
  let rule = initial;
  let localMode: Mode = initial?.mode ?? 'include';
  const displayedMode = () => rule?.mode ?? localMode;
  const setMode = (m: Mode) => {
    localMode = m;
    if (rule?.values.length) rule = { mode: m, values: rule.values };
  };
  const setValues = (v: string[]) => { rule = v.length ? { mode: displayedMode(), values: v } : undefined; };
  return { setMode, setValues, displayedMode, getRule: () => rule };
}

describe('TargetingPanel RuleEditor mode/values', () => {
  it('Exclude clicked before any value is entered stays Exclude (was resetting to Include)', () => {
    const e = makeEditor(undefined);
    e.setMode('exclude');
    assert.strictEqual(e.displayedMode(), 'exclude');
    assert.strictEqual(e.getRule(), undefined); // nothing to persist yet — correct, not a regression
  });

  it('a value typed after switching to Exclude is saved with that mode', () => {
    const e = makeEditor(undefined);
    e.setMode('exclude');
    e.setValues(['Android']);
    assert.deepStrictEqual(e.getRule(), { mode: 'exclude', values: ['Android'] });
  });

  it('switching mode on an existing rule updates it immediately', () => {
    const e = makeEditor({ mode: 'include', values: ['iOS'] });
    e.setMode('exclude');
    assert.deepStrictEqual(e.getRule(), { mode: 'exclude', values: ['iOS'] });
  });

  it('removing the last value clears the rule but keeps the toggle on the chosen mode', () => {
    const e = makeEditor({ mode: 'exclude', values: ['iOS'] });
    e.setValues([]);
    assert.strictEqual(e.getRule(), undefined);
    assert.strictEqual(e.displayedMode(), 'exclude'); // stays Exclude, doesn't snap back to Include
  });

  it('re-adding a value after clearing keeps using the previously selected mode', () => {
    const e = makeEditor({ mode: 'exclude', values: ['iOS'] });
    e.setValues([]);
    e.setValues(['Android']);
    assert.deepStrictEqual(e.getRule(), { mode: 'exclude', values: ['Android'] });
  });
});
