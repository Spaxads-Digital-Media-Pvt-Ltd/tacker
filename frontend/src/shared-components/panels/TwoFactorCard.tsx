/**
 * Your two-factor sign-in (Super Admin › Team › Your account, and the setup screen when the platform requires
 * it): set it up with an authenticator app (the key to type in, or the link that opens the app), confirm with a
 * code, keep the 10 recovery codes (shown once — copy or download them); new recovery codes; turn it off (your
 * password; not while it's required).
 */
import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useMutation } from '../../lib/useApi';
import { usePlatformMe } from '../../lib/platformMe';
import { Field } from '../primitives/ui';
import { CopyBox } from './CopyBox';
import { QrCode } from '../primitives/QrCode';

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join('\n');
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`Recovery codes — each works once\n\n${text}\n`], { type: 'text/plain' }));
    a.download = 'recovery-codes.txt'; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-3">
      <p className="text-small font-medium text-fg">Your recovery codes — shown only now</p>
      <p className="text-small text-fg-secondary">If you lose your phone, sign in with one of these instead of a code. Each works once. Keep them somewhere safe (a password manager).</p>
      <div className="grid grid-cols-2 gap-1 rounded-[var(--radius)] border border-border bg-page p-3 font-mono text-small text-fg sm:grid-cols-5">
        {codes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" onClick={() => void navigator.clipboard?.writeText(text)}>Copy</button>
        <button type="button" className="btn-ghost" onClick={download}>Download</button>
        <button type="button" className="btn-primary" onClick={onDone}>I’ve saved them</button>
      </div>
    </div>
  );
}

export function TwoFactorCard({ onChanged }: { onChanged?: () => void }) {
  const { me, refetch } = usePlatformMe();
  const tf = me?.twoFactor;
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'idle' | 'disable' | 'regenerate'>('idle');
  const start = useMutation(() => api.post<{ secret: string; otpauthUrl: string }>('/platform/me/2fa/setup', {}));
  const enable = useMutation((c: string) => api.post<{ recoveryCodes: string[] }>('/platform/me/2fa/enable', { code: c }));
  const regen = useMutation((c: string) => api.post<{ recoveryCodes: string[] }>('/platform/me/2fa/recovery-codes', { code: c }));
  const disable = useMutation((p: string) => api.post('/platform/me/2fa/disable', { password: p }));
  const changed = () => { refetch(); onChanged?.(); };

  if (!tf) return null;
  const onEnable = async (e: FormEvent) => {
    e.preventDefault();
    const r = await enable.run(code.trim());
    if (r) { setCodes(r.recoveryCodes); setSetup(null); setCode(''); }
  };
  const onRegen = async (e: FormEvent) => {
    e.preventDefault();
    const r = await regen.run(code.trim());
    if (r) { setCodes(r.recoveryCodes); setCode(''); setMode('idle'); }
  };
  const onDisable = async (e: FormEvent) => {
    e.preventDefault();
    if (await disable.run(password)) { setPassword(''); setMode('idle'); changed(); }
  };

  return (
    <div className="card max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-h3 font-medium text-fg"><ShieldCheck size={18} className={tf.enabled ? 'text-success' : 'text-fg-muted'} />Two-factor sign-in</h3>
          <p className="text-small text-fg-secondary">
            {tf.enabled ? `On — a code from your authenticator app at every sign-in. ${tf.recoveryCodesLeft} recovery code(s) left.`
              : tf.required ? 'Required for every member of the platform team — set it up to continue.'
              : 'A 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy…) after your password.'}
          </p>
        </div>
      </div>

      {codes ? <RecoveryCodes codes={codes} onDone={() => { setCodes(null); changed(); }} /> : !tf.enabled ? (
        setup ? (
          <form onSubmit={onEnable} className="space-y-3">
            <p className="text-small text-fg">1. Scan this QR code with your authenticator app — or add an account with the key below (or open the link on your phone):</p>
            <QrCode value={setup.otpauthUrl} title="Authenticator setup QR code" />
            <CopyBox value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} />
            <a href={setup.otpauthUrl} className="text-tiny font-medium text-accent-text hover:underline">Open in my authenticator app</a>
            <p className="text-small text-fg">2. Enter the 6-digit code it shows:</p>
            <div className="flex flex-wrap gap-2">
              <input className="input max-w-[10rem] text-center font-mono tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
              <button type="submit" className="btn-primary" disabled={enable.busy || code.trim().length < 6}>{enable.busy ? 'Checking…' : 'Turn on'}</button>
              <button type="button" className="btn-ghost" onClick={() => setSetup(null)}>Cancel</button>
            </div>
            {enable.error && <p className="text-small text-danger-text">{enable.error}</p>}
          </form>
        ) : (
          <div>
            <button type="button" className="btn-primary" disabled={start.busy} onClick={async () => { const r = await start.run(undefined); if (r) setSetup(r); }}>{start.busy ? 'Starting…' : 'Set up two-factor sign-in'}</button>
            {start.error && <p className="mt-2 text-small text-danger-text">{start.error}</p>}
          </div>
        )
      ) : mode === 'regenerate' ? (
        <form onSubmit={onRegen} className="flex flex-wrap items-end gap-2">
          <Field label="A current code from your app"><input className="input max-w-[10rem] text-center font-mono" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <button type="submit" className="btn-primary" disabled={regen.busy}>New recovery codes</button>
          <button type="button" className="btn-ghost" onClick={() => setMode('idle')}>Cancel</button>
          {regen.error && <p className="w-full text-small text-danger-text">{regen.error}</p>}
        </form>
      ) : mode === 'disable' ? (
        <form onSubmit={onDisable} className="flex flex-wrap items-end gap-2">
          <Field label="Your password"><input className="input max-w-xs" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <button type="submit" className="btn-primary" disabled={disable.busy}>Turn off</button>
          <button type="button" className="btn-ghost" onClick={() => setMode('idle')}>Cancel</button>
          {disable.error && <p className="w-full text-small text-danger-text">{disable.error}</p>}
        </form>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button type="button" className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setMode('regenerate')}>New recovery codes</button>
          {!tf.required && <button type="button" className="text-tiny font-medium text-danger-text hover:underline" onClick={() => setMode('disable')}>Turn off</button>}
        </div>
      )}
    </div>
  );
}
