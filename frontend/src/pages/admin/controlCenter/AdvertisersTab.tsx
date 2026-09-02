import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { cc } from '../../../lib/controlCenter';
import { useQuery, useMutation } from '../../../lib/useApi';
import { Tabs } from '../../../components/ui';
import { EmptyShellTable } from '../../../components/EmptyShellTable';
import { InfoCard, InfoGrid, InfoRow, NotificationCard, type NotifyDef } from './shared';

const SUB_TABS = ['General', 'Default Notifications'] as const;

function GeneralSub() {
  const { data: config, refetch } = useQuery<Record<string, unknown>>('/api/control-center/config/advertisers');
  const general = (config?.general as Record<string, unknown> | undefined) ?? {};
  const signup = (config?.signup as Record<string, unknown> | undefined) ?? {};
  const [editingGeneral, setEditingGeneral] = useState(false);
  const [editingSignup, setEditingSignup] = useState(false);
  const [headerHtml, setHeaderHtml] = useState('');
  const [footerHtml, setFooterHtml] = useState('');
  const [hideTotalClick, setHideTotalClick] = useState(false);
  const [signupHeader, setSignupHeader] = useState('');
  const [signupConfirm, setSignupConfirm] = useState('');
  const saveMut = useMutation((body: Record<string, unknown>) => cc.putConfig('advertisers', body));
  const { data: fields, loading } = useQuery<Array<{ id: string; sortOrder: number; label: string; fieldType: string; required: boolean }>>('/api/custom-fields?entity=advertiser');

  const startGeneralEdit = () => {
    setHeaderHtml(String(general['htmlCustomHeader'] ?? ''));
    setFooterHtml(String(general['htmlCustomFooter'] ?? ''));
    setHideTotalClick(Boolean(general['hideTotalClick']));
    setEditingGeneral(true);
  };

  const startSignupEdit = () => {
    setSignupHeader(String(signup['customSignUpHeader'] ?? ''));
    setSignupConfirm(String(signup['customSignUpConfirmation'] ?? ''));
    setEditingSignup(true);
  };

  const saveGeneral = async () => {
    const ok = await saveMut.run({ general: { htmlCustomHeader: headerHtml, htmlCustomFooter: footerHtml, hideTotalClick } });
    if (ok) { setEditingGeneral(false); refetch(); }
  };

  const saveSignup = async () => {
    const ok = await saveMut.run({ signup: { customSignUpHeader: signupHeader, customSignUpConfirmation: signupConfirm } });
    if (ok) { setEditingSignup(false); refetch(); }
  };

  const cfRows = (fields ?? []).map((f) => ({
    id: f.id,
    cells: {
      Order: String(f.sortOrder),
      Label: f.label,
      'Field Type': f.fieldType,
      Required: f.required ? 'Yes' : 'No',
    },
  }));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <InfoCard title="General" action={editingGeneral ? <span /> : <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={startGeneralEdit}><Pencil size={12} />Edit</button>}>
        {editingGeneral ? (
          <div className="space-y-4">
            <div>
              <label className="label mb-1 block">HTML Custom Header (Left menu)</label>
              <textarea className="input w-full" rows={3} value={headerHtml} onChange={(e) => setHeaderHtml(e.target.value)} />
            </div>
            <div>
              <label className="label mb-1 block">HTML Custom Footer (Left menu)</label>
              <textarea className="input w-full" rows={3} value={footerHtml} onChange={(e) => setFooterHtml(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-small text-fg">
              <input type="checkbox" checked={hideTotalClick} onChange={(e) => setHideTotalClick(e.target.checked)} className="h-4 w-4 rounded border-border" />
              Hide Total Click
            </label>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" className="btn-ghost" onClick={() => setEditingGeneral(false)} disabled={saveMut.busy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={saveGeneral} disabled={saveMut.busy}>{saveMut.busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : (
          <InfoGrid>
            <InfoRow label="HTML Custom Header (Left menu)" value={String(general['htmlCustomHeader'] ?? '')} />
            <InfoRow label="HTML Custom Footer (Left menu)" value={String(general['htmlCustomFooter'] ?? '')} />
            <InfoRow label="Hide Total Click" value={general['hideTotalClick'] ? 'YES' : 'NO'} />
          </InfoGrid>
        )}
      </InfoCard>
      <InfoCard title="Advertiser Sign Up Form Customization" action={editingSignup ? <span /> : <button className="flex items-center gap-1 text-tiny font-medium text-accent-text" onClick={startSignupEdit}><Pencil size={12} />Edit</button>}>
        {editingSignup ? (
          <div className="space-y-4">
            <div>
              <label className="label mb-1 block">Custom Sign Up Header</label>
              <textarea className="input w-full" rows={4} value={signupHeader} onChange={(e) => setSignupHeader(e.target.value)} />
            </div>
            <div>
              <label className="label mb-1 block">Custom Sign Up Confirmation</label>
              <textarea className="input w-full" rows={4} value={signupConfirm} onChange={(e) => setSignupConfirm(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" className="btn-ghost" onClick={() => setEditingSignup(false)} disabled={saveMut.busy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={saveSignup} disabled={saveMut.busy}>{saveMut.busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : (
          <InfoGrid>
            <InfoRow label="Custom Sign Up Header" value={String(signup['customSignUpHeader'] ?? '')} />
            <InfoRow label="Custom Sign Up Confirmation" value={String(signup['customSignUpConfirmation'] ?? '')} />
          </InfoGrid>
        )}
        <p className="mb-2 mt-4 text-small font-semibold text-fg">Custom Fields Summary</p>
        <EmptyShellTable search={false} columns={['Order', 'Label', 'Field Type', 'Required']} rows={cfRows} loading={loading} />
      </InfoCard>
    </div>
  );
}

const NETWORK_NOTIFS: NotifyDef[] = [
  { name: 'Communication Hub Email (from network)', desc: 'When a Communication Hub Email is sent to you', email: true },
];

function NotificationsSub() {
  const { data: config } = useQuery<Record<string, unknown>>('/api/control-center/config/advertisers');
  const saved = (config?.notifications as Record<string, unknown> | undefined) ?? {};
  const saveMut = useMutation(async () => {
    const res = await cc.putConfig('advertisers', { notifications: { ...saved, network: saved['network'] ?? {} } });
    return !!res;
  });

  return (
    <NotificationCard title="Network" notifs={NETWORK_NOTIFS} onSave={async () => !!(await saveMut.run(undefined))} />
  );
}

export default function AdvertisersTab() {
  const [sub, setSub] = useState<string>('General');
  return (
    <>
      <Tabs tabs={[...SUB_TABS]} active={sub} onChange={setSub} />
      {sub === 'General' && <GeneralSub />}
      {sub === 'Default Notifications' && <NotificationsSub />}
    </>
  );
}
