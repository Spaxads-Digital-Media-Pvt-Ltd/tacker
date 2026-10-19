/**
 * Links into the SPA that emails carry (sign-in, password reset): the first configured dashboard
 * origin (the CORS list, DASHBOARD_ORIGINS), else the Vite dev server.
 */
import { env } from '../config/env.js';

export function appUrl(path: string): string {
  const origin = env.DASHBOARD_ORIGINS?.split(',').map((s) => s.trim()).find((s) => s && s !== '*');
  return `${(origin ?? 'http://localhost:5173').replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
