import { useState } from 'react';
import { Info } from 'lucide-react';
import { cc } from '../../../lib/controlCenter';
import { useQuery, useMutation } from '../../../lib/useApi';
import { Tabs, Field } from '../../../components/ui';
import { EmptyShellTable } from '../../../components/EmptyShellTable';
import {
  InfoCard, InfoGrid, InfoRow, NotificationCard, YesNoToggle, EditHeaderAction,
  type NotifyDef, type NotifySaved,
} from './shared';

const SUB_TABS = ['General', 'Default Notifications'] as const;
const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese'];

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
  const [customizeHeader, setCustomizeHeader] = useState(true);
  const [customizeConfirmation, setCustomizeConfirmation] = useState(false);
  const [externalUrl, setExternalUrl] = useState(false);
  const [externalSignUpUrl, setExternalSignUpUrl] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [language, setLanguage] = useState('English');
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
    setCustomizeHeader(signup['customizeHeader'] !== false);
    setCustomizeConfirmation(Boolean(signup['customizeConfirmation']));
    setExternalUrl(Boolean(signup['useExternalSignUpUrl']));
    setExternalSignUpUrl(String(signup['externalSignUpUrl'] ?? ''));
    setAutoApprove(Boolean(signup['autoApproveAdvertisers']));
    setLanguage(String(signup['language'] ?? 'English'));
    setEditingSignup(true);
  };

  const saveGeneral = async () => {
    const ok = await saveMut.run({ general: { htmlCustomHeader: headerHtml, htmlCustomFooter: footerHtml, hideTotalClick } });
    if (ok) { setEditingGeneral(false); refetch(); }
  };

  const saveSignup = async () => {
    const ok = await saveMut.run({
      signup: {
        customSignUpHeader: signupHeader,
        customSignUpConfirmation: signupConfirm,
        customizeHeader,
        customizeConfirmation,
        useExternalSignUpUrl: externalUrl,
        externalSignUpUrl,
        autoApproveAdvertisers: autoApprove,
        language,
      },
    });
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
      <InfoCard
        title="General"
        action={<EditHeaderAction editing={editingGeneral} saving={saveMut.busy} onEdit={startGeneralEdit} onCancel={() => setEditingGeneral(false)} />}
      >
        {editingGeneral ? (
          <div className="space-y-4">
            <p className="flex items-center gap-1.5 text-tiny text-fg-secondary"><Info size={13} className="text-fg-muted" /> Fields with an asterisk (*) are mandatory.</p>
            {saveMut.error && <p className="text-small text-danger-text">{saveMut.error}</p>}
            <Field label="HTML Custom Header (Left menu)">
              <textarea className="input w-full" rows={3} value={headerHtml} onChange={(e) => setHeaderHtml(e.target.value)} />
            </Field>
            <Field label="HTML Custom Footer (Left menu)">
              <textarea className="input w-full" rows={3} value={footerHtml} onChange={(e) => setFooterHtml(e.target.value)} />
            </Field>
            <div>
              <label className="label mb-2 block">Hide Total Click</label>
              <YesNoToggle value={hideTotalClick} onChange={setHideTotalClick} />
            </div>
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
      <InfoCard
        title="Advertiser Sign Up Form Customization"
        action={<EditHeaderAction editing={editingSignup} saving={saveMut.busy} onEdit={startSignupEdit} onCancel={() => setEditingSignup(false)} />}
      >
        {editingSignup ? (
          <div className="space-y-4">
            <p className="flex items-center gap-1.5 text-tiny text-fg-secondary"><Info size={13} className="text-fg-muted" /> Fields with an asterisk (*) are mandatory.</p>
            {saveMut.error && <p className="text-small text-danger-text">{saveMut.error}</p>}
            <div>
              <label className="label mb-2 block">Use External Sign Up URL</label>
              <YesNoToggle value={externalUrl} onChange={setExternalUrl} />
              {externalUrl && (
                <div className="mt-3">
                  <Field label="External Sign Up URL">
                    <input className="input" value={externalSignUpUrl} onChange={(e) => setExternalSignUpUrl(e.target.value)} placeholder="https://" />
                  </Field>
                </div>
              )}
            </div>
            <div>
              <label className="label mb-2 block">Customize Header</label>
              <YesNoToggle value={customizeHeader} onChange={setCustomizeHeader} />
              {customizeHeader && (
                <div className="mt-3 rounded-card border border-border bg-page p-3">
                  <label className="label mb-2 block">Custom Sign Up Header</label>
                  <textarea rows={4} className="input w-full font-mono text-tiny" value={signupHeader} onChange={(e) => setSignupHeader(e.target.value)} />
                </div>
              )}
            </div>
            <div>
              <label className="label mb-2 block">Customize Confirmation</label>
              <YesNoToggle value={customizeConfirmation} onChange={setCustomizeConfirmation} />
              {customizeConfirmation && (
                <div className="mt-3 rounded-card border border-border bg-page p-3">
                  <label className="label mb-2 block">Custom Sign Up Confirmation</label>
                  <textarea rows={4} className="input w-full font-mono text-tiny" value={signupConfirm} onChange={(e) => setSignupConfirm(e.target.value)} />
                </div>
              )}
            </div>
            <div>
              <label className="label mb-2 block">Auto Approve Advertisers</label>
              <YesNoToggle value={autoApprove} onChange={setAutoApprove} />
            </div>
            <Field label="Language *">
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input !w-56">
                {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
              </select>
            </Field>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <button type="button" className="btn-ghost" onClick={() => setEditingSignup(false)} disabled={saveMut.busy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={saveSignup} disabled={saveMut.busy}>{saveMut.busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        ) : (
          <InfoGrid>
            <InfoRow label="Custom Sign Up Header" value={String(signup['customSignUpHeader'] ?? '')} />
            <InfoRow label="Custom Sign Up Confirmation" value={String(signup['customSignUpConfirmation'] ?? '')} />
            <InfoRow label="Auto Approve Advertisers" value={signup['autoApproveAdvertisers'] ? 'YES' : 'NO'} />
            <InfoRow label="Language" value={String(signup['language'] ?? 'English')} />
            <InfoRow label="Use External Sign Up URL" value={signup['useExternalSignUpUrl'] ? 'YES' : 'NO'} />
            <InfoRow label="External Sign Up URL" value={String(signup['externalSignUpUrl'] ?? '')} />
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
  const { data: config, refetch } = useQuery<Record<string, unknown>>('/api/control-center/config/advertisers');
  const saved = (config?.notifications as Record<string, unknown> | undefined)?.['network'] as NotifySaved | undefined;

  return (
    <NotificationCard
      title="Network"
      notifs={NETWORK_NOTIFS}
      saved={saved}
      onSave={async (values) => {
        const res = await cc.putConfig('advertisers', { notifications: { network: values } });
        if (res) refetch();
        return !!res;
      }}
    />
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
