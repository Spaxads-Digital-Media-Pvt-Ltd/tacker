/**
 * The 4-up gradient stat-card header used on the "Manage" list screens (Offers, Affiliates,
 * Advertisers, Access) — matches the Everflow/Spaxads look. Fetches a `/stats` endpoint that returns
 * a flat object of counts; each card names which key to show.
 */
import { useQuery } from '../lib/useApi';
import { Icon } from './icons';

type Tone = 'blue' | 'green' | 'red' | 'amber';
const TONE: Record<Tone, string> = {
  blue: 'from-info/15 to-info/5 text-info-text',
  green: 'from-success/15 to-success/5 text-success-text',
  red: 'from-danger/15 to-danger/5 text-danger-text',
  amber: 'from-warning/15 to-warning/5 text-warning-text',
};

export interface StatCardDef { key: string; label: string; tone: Tone; icon: keyof typeof Icon }

export function StatCards({ endpoint, cards }: { endpoint: string; cards: StatCardDef[] }) {
  const { data } = useQuery<Record<string, number>>(endpoint);
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => {
        const Ic = Icon[c.icon];
        return (
          <div key={c.key} className={`rounded-xl border border-border bg-gradient-to-br p-3 shadow-card ${TONE[c.tone]}`}>
            <div className="flex items-start justify-between">
              <p className="text-tiny font-semibold uppercase tracking-wide text-fg-secondary">{c.label}</p>
              <Ic width={16} height={16} />
            </div>
            <p className="mt-1.5 text-xl font-bold tracking-tight text-fg">{data ? (data[c.key] ?? 0) : '—'}</p>
          </div>
        );
      })}
    </div>
  );
}
