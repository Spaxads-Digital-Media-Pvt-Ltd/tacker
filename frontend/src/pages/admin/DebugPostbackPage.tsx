import { useState } from 'react';
import { useQuery } from '../../lib/useApi';
import { PageHeader, Field } from '../../components/ui';
import { PostbackTester } from '../../components/PostbackTester';
import type { Advertiser } from '../../types';

/** Advertisers › Debug Postback — pick an advertiser, then fire a debug conversion postback. */
export default function DebugPostbackPage() {
  const { data: advertisers } = useQuery<Advertiser[]>('/api/advertisers');
  const [advId, setAdvId] = useState('');
  return (
    <>
      <PageHeader title="Debug Postback" subtitle="Fire a debug conversion postback for an advertiser with sample macros." />
      <div className="card max-w-2xl mx-auto space-y-4">
        <Field label="Advertiser">
          <select className="input max-w-md" value={advId} onChange={(e) => setAdvId(e.target.value)}>
            <option value="">Select an advertiser…</option>
            {(advertisers ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        {advId
          ? <PostbackTester key={advId} testPath={`/api/advertisers/${advId}/debug-postback`} hint="Fire the advertiser's conversion postback URL with sample macros. No conversion is recorded." />
          : <p className="text-small text-fg-secondary">Select an advertiser to begin.</p>}
      </div>
    </>
  );
}
