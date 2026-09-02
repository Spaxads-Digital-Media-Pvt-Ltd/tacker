/**
 * Marketplace › Your Profile(s) — preview how this network presents itself in the marketplace directory.
 */
import { Link } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Spinner, StateBlock } from '../../components/ui';
import { Icon } from '../../components/icons';
import { MarketplaceProfileCards } from '../../components/MarketplaceProfileCards';
import type { MarketplaceProfile } from '../../types';

export default function MarketplaceProfilePage() {
  const { data, loading, error } = useQuery<MarketplaceProfile | null>('/api/marketplace-profile');

  return (
    <>
      <PageHeader title="Your Marketplace Profile" subtitle="Marketplace › Profile" action={
        <button title="Not available yet" className="grid h-9 w-9 place-items-center rounded-[var(--radius)] border border-border bg-surface text-fg-secondary hover:bg-accent-subtle hover:text-fg">
          <MoreVertical size={15} />
        </button>
      } />

      <div className="card mb-4 flex items-center justify-between">
        <span className="text-small font-medium text-fg">Preview</span>
        <Link to="/app/marketplace/profile/edit" className="rounded-[var(--radius)] border border-border bg-surface px-3 py-1.5 text-tiny font-medium text-fg hover:bg-accent-subtle">Edit</Link>
      </div>

      {loading ? <div className="card"><StateBlock><Spinner /></StateBlock></div>
        : error ? <div className="card"><StateBlock>{error}</StateBlock></div>
        : !data ? (
          <div className="card flex flex-col items-center gap-3 py-10 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-accent-subtle text-accent-text"><Icon.building width={26} height={26} /></div>
            <p className="font-medium text-fg">You haven't set up a Marketplace Profile yet</p>
            <p className="max-w-sm text-small text-fg-muted">Set your name, logo, categories, and contact details so this network has a profile to show.</p>
            <Link to="/app/marketplace/profile/edit" className="btn-primary">Set Up Your Profile</Link>
          </div>
        ) : (
          <div className="card">
            <MarketplaceProfileCards profile={data} />
          </div>
        )}
    </>
  );
}
