import { useEffect, useRef, useState } from 'react';

export function CopyBox({ value, placeholder = 'Select an affiliate to generate the link…' }: { value: string; placeholder?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      // Clipboard can be unavailable (insecure origin) or refused — say so instead of failing silently.
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  };

  return (
    <div className="flex items-start gap-2">
      <div className="min-h-[44px] flex-1 select-all break-all rounded-[var(--radius)] border border-border bg-page px-3 py-2 font-mono text-tiny text-fg">
        {value || <span className="text-fg-muted">{placeholder}</span>}
      </div>
      <button type="button" disabled={!value} onClick={copy} className="btn-ghost shrink-0">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Could not copy — select the text and copy it manually' : ''}
      </span>
    </div>
  );
}
