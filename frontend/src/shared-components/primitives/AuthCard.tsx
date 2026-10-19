import type { ReactNode } from 'react';
import { Brandmark } from './Brandmark';

/** The centred card the signed-out screens use (forgot / reset / first-sign-in password). */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center bg-page p-6">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-8 flex justify-center">
          <Brandmark />
        </div>
        <div className="card !p-8">
          <h1 className="text-h1 font-bold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1.5 text-small text-fg-secondary">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

/** The red message box the auth screens show above their form. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5 rounded-[var(--radius)] border border-danger-bg bg-danger-bg px-4 py-3 text-small text-danger-text">
      {children}
    </div>
  );
}
