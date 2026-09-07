/**
 * Facebook Conversions API — server-side Purchase/Lead events on approved conversions.
 * https://developers.facebook.com/docs/marketing-api/conversions-api
 */
import { loadIntegrations } from './settings.js';

export interface FacebookCapiEvent {
  networkId: string;
  conversionId: string;
  eventName: string | null;
  payout: string | null;
  currency: string | null;
  clickId: string;
}

const TIMEOUT_MS = 10_000;

function mapEventName(event: string | null): string {
  const e = (event ?? '').toLowerCase();
  if (['lead', 'signup', 'register'].some((k) => e.includes(k))) return 'Lead';
  if (['install', 'app'].some((k) => e.includes(k))) return 'CompleteRegistration';
  return 'Purchase';
}

export async function sendFacebookCapiEvent(input: FacebookCapiEvent): Promise<{ ok: boolean; error?: string }> {
  const cfg = await loadIntegrations(input.networkId);
  const pixelId = cfg.fbPixelId;
  const accessToken = cfg.fbAccessToken;
  if (!pixelId || !accessToken) return { ok: false, error: 'not_configured' };

  const eventTime = Math.floor(Date.now() / 1000);
  const value = input.payout != null ? Number(input.payout) : undefined;
  const body = {
    data: [{
      event_name: mapEventName(input.eventName),
      event_time: eventTime,
      event_id: input.conversionId,
      action_source: 'website',
      user_data: { client_ip_address: '0.0.0.0', client_user_agent: 'tracker' },
      custom_data: {
        ...(value != null && !Number.isNaN(value) ? { value, currency: input.currency ?? 'USD' } : {}),
        click_id: input.clickId,
      },
    }],
    access_token: accessToken,
  };

  const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(pixelId)}/events`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `http_${res.status}:${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).name === 'AbortError' ? 'timeout' : String((err as Error).message) };
  } finally {
    clearTimeout(timer);
  }
}
