import { api } from './api';

export type ConfigSection = 'platform' | 'partners' | 'advertisers' | 'security';

export const cc = {
  getConfig: (section: ConfigSection) => api.get<Record<string, unknown>>(`/api/control-center/config/${section}`),
  putConfig: (section: ConfigSection, body: Record<string, unknown>) =>
    api.put<Record<string, unknown>>(`/api/control-center/config/${section}`, body),

  createUser: (body: Record<string, unknown>) => api.post('/api/control-center/users', body),

  usage: (year?: number) => api.get<{ year: number; rows: { month: string; impressions: number; offersPulled: number }[] }>(
    `/api/control-center/usage${year ? `?year=${year}` : ''}`,
  ),

  list: <T>(resource: string, status = 'active') =>
    api.get<T[]>(`/api/control-center/${resource}?status=${status}`),
  create: (resource: string, body: Record<string, unknown>) =>
    api.post(`/api/control-center/${resource}`, body),
  del: (resource: string, id: string) => api.del(`/api/control-center/${resource}/${id}`),

  ipBlacklist: {
    get: () => api.get<{ id: string; from: string; to: string }[]>('/api/control-center/ip-blacklist'),
    put: (ranges: { from: string; to?: string }[]) => api.put('/api/control-center/ip-blacklist', { ranges }),
  },

  tagsWithUsage: () => api.get<Array<{
    id: string; name: string; color: string | null;
    advertisers: number; partners: number; offers: number; partnerTiers: number;
  }>>('/api/control-center/tags-with-usage'),

  loginEvents: () => api.get<Array<{
    id: string; employee: string; ip: string | null; country: string | null; city: string | null;
    userAgent: string | null; platform: string | null; deviceType: string | null;
    osVersion: string | null; browser: string | null; existingDevice: boolean; createdAt: string;
  }>>('/api/control-center/login-events'),

  partnerReferrals: (status = 'all') =>
    api.get(`/api/control-center/partner-referrals?status=${status}`),
  termsAcceptances: () => api.get('/api/control-center/terms-acceptances'),

  apiWhitelist: {
    list: () => api.get<Array<{ id: string; ipAddress: string; createdAt: string }>>('/api/control-center/api-whitelist'),
    add: (ipAddress: string) => api.post('/api/control-center/api-whitelist', { ipAddress }),
    del: (id: string) => api.del(`/api/control-center/api-whitelist/${id}`),
  },
};
