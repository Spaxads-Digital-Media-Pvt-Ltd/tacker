import { useState } from 'react';

export function CopyBox({ value, placeholder = 'Select an affiliate to generate the link…' }: { value: string; placeholder?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <div className="min-h-[44px] flex-1 break-all rounded-[var(--radius)] border border-border bg-page px-3 py-2 font-mono text-tiny text-fg">
        {value || <span className="text-fg-muted">{placeholder}</span>}
      </div>
      <button type="button" disabled={!value}
        onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="btn-ghost shrink-0">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
