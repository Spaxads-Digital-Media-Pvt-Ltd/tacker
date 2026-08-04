/**
 * The 4-up stat-card header used on the "Manage" list screens (Offers, Affiliates, Advertisers,
 * Access). Fetches a `/stats` endpoint that returns a flat object of counts; each card names which
 * key to show. Clean bordered cards with a tinted icon chip + a thin colored top rule — deliberately
 * calmer than a gradient-block treatment, closer to a statement/ledger reading.
 */
import { useQuery } from '../lib/useApi';
import { Icon } from './icons';
import { TONE_CHIP, type Tone } from '../lib/tones';

export interface StatCardDef { key: string; label: string; tone: Tone; icon: keyof typeof Icon }

const TOP_RULE: Record<Tone, string> = {
  teal: 'bg-teal-500', blue: 'bg-sky-500', amber: 'bg-amber-500', violet: 'bg-violet-500', rose: 'bg-rose-500',
};

export function StatCards({ endpoint, cards }: { endpoint: string; cards: StatCardDef[] }) {
  const { data } = useQuery<Record<string, number>>(endpoint);
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((c) => {
        const Ic = Icon[c.icon];
        return (
          <div key={c.key} className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
            <div className={`h-1 w-full ${TOP_RULE[c.tone]}`} />
            <div className="p-5">
              <div className="flex items-start justify-between">
                <p className="eyebrow">{c.label}</p>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${TONE_CHIP[c.tone]}`}><Ic width={16} height={16} /></span>
              </div>
              <p className="mt-3 font-display text-3xl font-bold tracking-tight text-fg">{data ? (data[c.key] ?? 0) : '—'}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
