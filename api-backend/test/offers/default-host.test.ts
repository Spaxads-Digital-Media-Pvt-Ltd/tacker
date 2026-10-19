/**
 * Which tracking domain links use when nothing more specific was chosen (lib/tracking-domains/default-host.ts).
 */
import { describe, it, expect } from 'vitest';
import { pickDefaultDomain, isLoopbackHost, isTunnelHost, type DomainCandidate } from '../../src/lib/tracking-domains/default-host.js';

let n = 0;
const d = (host: string, over: Partial<DomainCandidate> = {}): DomainCandidate => ({
  id: `d${++n}`, host, status: 'active', verification_state: 'verified', is_primary: false,
  created_at: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(), ...over,
});
const pick = (rows: DomainCandidate[], live: string | null = 'acme.track.example') => pickDefaultDomain(rows, live)?.host ?? null;

describe('the default link domain', () => {
  it('the primary wins — while it is active and verified', () => {
    expect(pick([d('localhost'), d('go.acme.com'), d('promo.acme.com', { is_primary: true })])).toBe('promo.acme.com');
    expect(pick([d('promo.acme.com', { is_primary: true, status: 'disabled' }), d('go.acme.com')])).toBe('go.acme.com');
    expect(pick([d('promo.acme.com', { is_primary: true, verification_state: 'pending' }), d('127.0.0.1')])).toBe('127.0.0.1');
  });

  it('without a primary: the domain the tracking server is live on for the network, then other real domains', () => {
    expect(pick([d('localhost'), d('go.acme.com'), d('acme.track.example')])).toBe('acme.track.example');
    expect(pick([d('127.0.0.1'), d('localhost'), d('go.acme.com'), d('later.acme.com')], null)).toBe('go.acme.com'); // the oldest
  });

  it('a tunnel (the newest) beats localhost; localhost / 127.0.0.1 only when nothing else is active', () => {
    expect(pick([d('127.0.0.1'), d('old.ngrok-free.app'), d('new.ngrok-free.app'), d('localhost')])).toBe('new.ngrok-free.app');
    expect(pick([d('localhost'), d('127.0.0.1')])).toBe('localhost');
    expect(pick([d('go.acme.com', { status: 'pending', verification_state: 'pending' })])).toBeNull();
    expect(pick([])).toBeNull();
  });

  it('classifies development hosts', () => {
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.0.0.2')).toBe(false);
    expect(isTunnelHost('ab12.ngrok-free.dev')).toBe(true);
    expect(isTunnelHost('ngrok.acme.com')).toBe(false);
  });
});
