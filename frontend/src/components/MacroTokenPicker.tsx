/**
 * MacroTokenPicker — clickable chip list of postback URL macros (Everflow-style).
 * Clicking a macro appends its token to the current URL value.
 */
import { MACROS } from '../data/creatives';
import { Field } from './ui';

export function MacroTokenPicker({
 value, onChange,
}: {
 value: string;
 onChange: (v: string) => void;
}) {
 const insert = (token: string) => onChange(value + token);

 return (
 <Field label="Available Macros">
 <div className="flex flex-wrap gap-1.5">
 {MACROS.map((m) => (
 <button
 key={m.token}
 type="button"
 onClick={() => insert(m.token)}
 title={`Insert ${m.token}`}
 className="rounded-md border border-border bg-page px-2 py-1 text-tiny font-mono text-fg-secondary hover:border-accent hover:text-accent-text transition-colors"
 >
 {m.token}
 <span className="ml-1.5 text-[10px] text-fg-muted normal-case">{m.label}</span>
 </button>
 ))}
 </div>
 <p className="mt-1.5 text-[11px] text-fg-muted">Click a macro to append it to the URL.</p>
 </Field>
 );
}
