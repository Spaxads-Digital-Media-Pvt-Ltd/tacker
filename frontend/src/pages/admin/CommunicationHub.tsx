/**
 * Communication Hub — genuinely functional this pass (see api-backend's communication-hub/routes.ts
 * for the full honesty rationale): Audiences are saved filters over the real publishers/advertisers
 * tables with a live recipient count; Email Messages actually send via the network's own SMTP
 * settings (Settings › SMTP) to each recipient's real contact_email; Partner Banners really display
 * on the Publisher portal; Automated System Emails lists real events this app's data model can fire
 * on, with a toggle that persists for real (wiring the ~14 actual triggers is a separate project).
 * Layout intentionally diverges from the reference's own multi-step wizard / WYSIWYG editor — a
 * single-page compose form covers the same real capability without reproducing a rich-text builder.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, Pencil, Trash2, Send } from 'lucide-react';
import { PageHeader, Tabs, Field, Modal, Spinner, StateBlock } from '../../components/ui';
import { Pagination } from '../../components/ReportPageKit';
import { useQuery, useMutation } from '../../lib/useApi';
import { api } from '../../lib/api';

const TOP_TABS = ['Overview', 'Emails', 'Banners', 'Audiences', 'Templates', 'Settings'] as const;
const EMAIL_SUBTABS = ['Sent', 'Scheduled', 'Drafts'] as const;
const BANNER_SUBTABS = ['Published', 'Scheduled', 'Drafts', 'Expired'] as const;
const PAGE_SIZE = 10;

interface Overview {
  emails: { drafts: number; scheduledThisWeek: number; sentThisMonth: number };
  banners: { publishedLive: number; scheduledThisWeek: number; drafts: number };
  topAudiences: { id: string; name: string; groupType: string; recipientCount: number }[];
  audiencesTotal: number;
  templates: { id: string; name: string; messageType: string }[];
  templatesTotal: number;
  systemEmailCategories: Record<string, number>;
  systemEmailsTotal: number;
  recentEmails: { id: string; subject: string; messageType: string; recipientCount: number; sentAt: string | null }[];
  recentBanners: { id: string; name: string; priority: string; status: string; publishAt: string | null; expireAt: string | null }[];
}
interface EmailMsg {
  id: string; subject: string; body?: string; messageType: string; audienceId?: string | null;
  status: 'draft' | 'scheduled' | 'sent'; recipientCount: number; sentAt: string | null;
  sendError: string | null; createdAt: string; updatedAt: string;
}
interface BannerRow {
  id: string; name: string; message: string; priority: string;
  status: 'draft' | 'scheduled' | 'published' | 'expired';
  publishAt: string | null; expireAt: string | null; createdAt: string; updatedAt: string;
}
interface AudienceRow {
  id: string; name: string; groupType: 'publishers' | 'advertisers'; statusFilter: string[];
  tierId: string | null; recipientCount: number; createdAt: string; updatedAt: string;
}
interface TemplateRow {
  id: string; name: string; messageType: string; subject: string; body: string;
  createdAt: string; updatedAt: string;
}
interface SystemEmail { key: string; label: string; category: 'partner' | 'advertiser' | 'misc'; enabled: boolean }
interface Tier { id: string; name: string }

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    sent: 'bg-success-bg text-success-text', published: 'bg-success-bg text-success-text',
    draft: 'bg-page text-fg-secondary', scheduled: 'bg-warning-bg text-warning-text',
    expired: 'bg-danger-bg text-danger-text',
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-tiny font-medium capitalize ${styles[status] ?? 'bg-page text-fg-secondary'}`}>{status}</span>;
}

function SubTabs<T extends string>({ tabs, active, onChange }: { tabs: readonly T[]; active: T; onChange: (t: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)}
          className={`-mb-px whitespace-nowrap px-3.5 py-2 text-small font-medium transition-colors ${active === t ? 'border-b-2 border-accent text-accent-text' : 'border-b-2 border-transparent text-fg-secondary hover:text-fg'}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-2">{children}</div>;
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

// ---------------- Overview ----------------
function OverviewTab({ goto }: { goto: (t: (typeof TOP_TABS)[number]) => void }) {
  const { data, loading } = useQuery<Overview>('/api/communication-hub/overview');
  if (loading || !data) return <StateBlock><Spinner /></StateBlock>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card space-y-3">
          <h3 className="text-h3 font-medium text-fg">Create Email Message</h3>
          <p className="text-small text-fg-secondary">Send personalized emails to your Partners, Advertisers, and/or team members.</p>
          <button className="btn-primary" onClick={() => goto('Emails')}>Quick Start</button>
          <div className="flex gap-6 border-t border-border pt-3 text-small">
            <span><b className="text-fg">{data.emails.drafts}</b> <span className="text-fg-secondary">Draft(s)</span></span>
            <span><b className="text-fg">{data.emails.scheduledThisWeek}</b> <span className="text-fg-secondary">Scheduled This Week</span></span>
            <span><b className="text-fg">{data.emails.sentThisMonth}</b> <span className="text-fg-secondary">Sent This Month</span></span>
          </div>
        </div>
        <div className="card space-y-3">
          <h3 className="text-h3 font-medium text-fg">Create Partner Banner</h3>
          <p className="text-small text-fg-secondary">Publish custom banners to Partner Dashboards to share information and updates.</p>
          <button className="btn-primary" onClick={() => goto('Banners')}>Quick Start</button>
          <div className="flex gap-6 border-t border-border pt-3 text-small">
            <span><b className="text-fg">{data.banners.publishedLive}</b> <span className="text-fg-secondary">Published and Live</span></span>
            <span><b className="text-fg">{data.banners.scheduledThisWeek}</b> <span className="text-fg-secondary">Set to Publish This Week</span></span>
            <span><b className="text-fg">{data.banners.drafts}</b> <span className="text-fg-secondary">Draft(s)</span></span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-h3 font-medium text-fg">Top Audiences</h3>
            <button className="text-small text-accent-text hover:underline" onClick={() => goto('Audiences')}>See All ({data.audiencesTotal})</button>
          </div>
          {data.topAudiences.length === 0 ? <p className="text-small text-fg-muted">No audiences yet.</p> : (
            <table className="w-full text-small">
              <tbody>
                {data.topAudiences.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-2 text-fg">{a.name}</td>
                    <td className="py-2 text-right text-fg-secondary capitalize">{a.groupType}</td>
                    <td className="py-2 pl-3 text-right text-fg-secondary">{a.recipientCount} recipient(s)</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-h3 font-medium text-fg">Email Templates</h3>
            <button className="text-small text-accent-text hover:underline" onClick={() => goto('Templates')}>See All ({data.templatesTotal})</button>
          </div>
          {data.templates.length === 0 ? <p className="text-small text-fg-muted">No templates yet.</p> : (
            <table className="w-full text-small">
              <tbody>
                {data.templates.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-2 text-fg">{t.name}</td>
                    <td className="py-2 text-right capitalize text-fg-secondary">{t.messageType.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-h3 font-medium text-fg">Automated System Emails</h3>
          <button className="text-small text-accent-text hover:underline" onClick={() => goto('Settings')}>See All ({data.systemEmailsTotal})</button>
        </div>
        <div className="flex gap-6 text-small">
          <span><b className="text-fg">{data.systemEmailCategories.partner ?? 0}</b> <span className="text-fg-secondary">Partner</span></span>
          <span><b className="text-fg">{data.systemEmailCategories.advertiser ?? 0}</b> <span className="text-fg-secondary">Advertiser</span></span>
          <span><b className="text-fg">{data.systemEmailCategories.misc ?? 0}</b> <span className="text-fg-secondary">Misc</span></span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-h3 font-medium text-fg">Email Messages</h3>
            <button className="text-small text-accent-text hover:underline" onClick={() => goto('Emails')}>See All</button>
          </div>
          {data.recentEmails.length === 0 ? <p className="text-small text-fg-muted">No Record Found</p> : (
            <table className="w-full text-small">
              <tbody>
                {data.recentEmails.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="py-2 text-fg">{e.subject}</td>
                    <td className="py-2 text-right text-fg-secondary">{e.recipientCount} Total Recipient</td>
                    <td className="py-2 pl-3 text-right text-fg-secondary">{fmt(e.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-h3 font-medium text-fg">Partner Banners</h3>
            <button className="text-small text-accent-text hover:underline" onClick={() => goto('Banners')}>See All</button>
          </div>
          {data.recentBanners.length === 0 ? <p className="text-small text-fg-muted">No Record Found</p> : (
            <table className="w-full text-small">
              <tbody>
                {data.recentBanners.map((b) => (
                  <tr key={b.id} className="border-t border-border">
                    <td className="py-2 text-fg">{b.name}</td>
                    <td className="py-2 text-right"><StatusPill status={b.status} /></td>
                    <td className="py-2 pl-3 text-right text-fg-secondary">{fmt(b.publishAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- Emails ----------------
function EmailComposeForm({ audiences, templates, initial, onSaved, onCancel }: {
  audiences: AudienceRow[]; templates: TemplateRow[]; initial?: EmailMsg;
  onSaved: () => void; onCancel: () => void;
}) {
  const editId = initial?.id;
  const { data: loaded, loading: loadingEmail } = useQuery<EmailMsg>(
    editId ? `/api/communication-hub/emails/${editId}` : null,
  );
  const source = editId && loaded ? loaded : initial;

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [messageType, setMessageType] = useState('general');
  const [audienceId, setAudienceId] = useState('');
  const { run, busy, error } = useMutation(async (args: { action: 'draft' | 'send' }) => {
    const payload = { subject, body, messageType, audienceId: audienceId || undefined };
    if (editId) {
      await api.put<{ id: string }>(`/api/communication-hub/emails/${editId}`, payload);
      if (args.action === 'send') {
        return api.post<{ id: string; sendError: string | null }>(`/api/communication-hub/emails/${editId}/send`);
      }
      return { id: editId, sendError: null };
    }
    return api.post<{ id: string; sendError: string | null }>('/api/communication-hub/emails', { ...payload, action: args.action });
  });

  useEffect(() => {
    if (source) {
      setSubject(source.subject);
      setBody(source.body ?? '');
      setMessageType(source.messageType);
      setAudienceId(source.audienceId ?? '');
    }
  }, [source?.id, source?.updatedAt]);

  const applyTemplate = (id: string) => {
    const t = templates.find((tt) => tt.id === id);
    if (t) { setSubject(t.subject); setBody(t.body); setMessageType(t.messageType); }
  };

  const submit = async (e: FormEvent, action: 'draft' | 'send') => {
    e.preventDefault();
    const res = await run({ action });
    if (res) onSaved();
  };

  if (editId && loadingEmail && !loaded) {
    return <StateBlock><Spinner /></StateBlock>;
  }

  return (
    <form onSubmit={(e) => submit(e, 'draft')} className="space-y-4">
      <p className="text-tiny text-fg-secondary">Fields with an asterisk (*) are mandatory.</p>
      {error && <p className="text-small text-danger-text">{error}</p>}
      {!initial && templates.length > 0 && (
        <Field label="Start from Template">
          <select className="input" onChange={(e) => applyTemplate(e.target.value)} defaultValue="">
            <option value="">Blank message</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="Subject *"><input className="input" required value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Message Type">
        <select className="input" value={messageType} onChange={(e) => setMessageType(e.target.value)}>
          <option value="general">General</option>
          <option value="offer_details">Offer Details</option>
        </select>
      </Field>
      <Field label="Audience *">
        <select className="input" required value={audienceId} onChange={(e) => setAudienceId(e.target.value)}>
          <option value="">Select an audience…</option>
          {audiences.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.recipientCount} recipient{a.recipientCount === 1 ? '' : 's'})</option>)}
        </select>
        {audiences.length === 0 && <p className="mt-1 text-tiny text-fg-muted">No audiences yet — create one in the Audiences tab first.</p>}
      </Field>
      <Field label="Message *"><textarea className="input min-h-40" required value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-ghost" disabled={busy}>Save Draft</button>
        <button type="button" className="btn-primary inline-flex items-center gap-1.5" disabled={busy || !audienceId}
          onClick={(e) => submit(e, 'send')}>
          <Send size={14} /> {busy ? 'Sending…' : 'Send Now'}
        </button>
      </div>
    </form>
  );
}

function EmailsTab() {
  const [sub, setSub] = useState<(typeof EMAIL_SUBTABS)[number]>('Sent');
  const [page, setPage] = useState(1);
  const [composing, setComposing] = useState<EmailMsg | null | 'new'>(null);
  const [viewing, setViewing] = useState<EmailMsg | null>(null);
  const { data: viewedEmail, loading: viewLoading } = useQuery<EmailMsg>(
    viewing ? `/api/communication-hub/emails/${viewing.id}` : null,
  );
  const status = sub === 'Sent' ? 'sent' : sub === 'Scheduled' ? 'scheduled' : 'draft';
  const { data, loading, refetch } = useQuery<EmailMsg[]>(`/api/communication-hub/emails?status=${status}`);
  const { data: audiencesData } = useQuery<AudienceRow[]>('/api/communication-hub/audiences');
  const { data: templatesData } = useQuery<TemplateRow[]>('/api/communication-hub/templates');
  const { run: runDelete } = useMutation((id: string) => api.del(`/api/communication-hub/emails/${id}`));
  const { run: runSend } = useMutation((id: string) => api.post(`/api/communication-hub/emails/${id}/send`));

  const rows = data ?? [];
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <SubTabs tabs={EMAIL_SUBTABS} active={sub} onChange={(t) => { setSub(t); setPage(1); }} />
      <Toolbar>
        <span />
        <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setComposing('new')}><Plus size={14} /> Create Message</button>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : rows.length === 0 ? (
        <StateBlock>No Record Found</StateBlock>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-small">
            <thead className="bg-page text-tiny text-fg-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Recipient count</th>
                {sub === 'Sent' && <th className="px-3 py-2 text-left">Sent</th>}
                <th className="px-3 py-2 text-left">Modified</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {paged.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="cursor-pointer px-3 py-2 text-fg hover:underline" onClick={() => setViewing(e)}>{e.subject}</td>
                  <td className="px-3 py-2 capitalize text-fg-secondary">{e.messageType.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-fg-secondary">{e.recipientCount} Total Recipient{e.recipientCount === 1 ? '' : 's'}</td>
                  {sub === 'Sent' && <td className="px-3 py-2 text-fg-secondary">{fmt(e.sentAt)}</td>}
                  <td className="px-3 py-2 text-fg-secondary">{fmt(e.updatedAt)}</td>
                  <td className="px-3 py-2 text-right">
                    {status === 'draft' && (
                      <div className="flex justify-end gap-1">
                        <button title="Edit" className="rounded p-1 text-fg-secondary hover:bg-accent-subtle hover:text-fg" onClick={() => setComposing(e)}><Pencil size={14} /></button>
                        <button title="Send now" className="rounded p-1 text-fg-secondary hover:bg-accent-subtle hover:text-fg" onClick={async () => { if (await runSend(e.id)) refetch(); }}><Send size={14} /></button>
                        <button title="Delete" className="rounded p-1 text-fg-secondary hover:bg-danger-subtle hover:text-danger-text" onClick={async () => { if (await runDelete(e.id)) refetch(); }}><Trash2 size={14} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3"><Pagination total={rows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>

      <Modal open={composing !== null} onClose={() => setComposing(null)} title={composing === 'new' ? 'Create Email Message' : 'Edit Draft'} size="xl">
        <EmailComposeForm
          audiences={audiencesData ?? []} templates={templatesData ?? []}
          initial={composing && composing !== 'new' ? composing : undefined}
          onSaved={() => { setComposing(null); refetch(); }} onCancel={() => setComposing(null)}
        />
      </Modal>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.subject ?? ''} size="xl">
        {viewing && (
          viewLoading && !viewedEmail ? <StateBlock><Spinner /></StateBlock> : (
            <div className="space-y-3">
              <div className="flex gap-4 text-small text-fg-secondary">
                <span>Type: <span className="capitalize text-fg">{(viewedEmail ?? viewing).messageType.replace('_', ' ')}</span></span>
                <span>Status: <StatusPill status={(viewedEmail ?? viewing).status} /></span>
                <span>Recipients: <span className="text-fg">{(viewedEmail ?? viewing).recipientCount}</span></span>
              </div>
              {(viewedEmail ?? viewing).sendError && <p className="text-small text-danger-text">{(viewedEmail ?? viewing).sendError}</p>}
              <div className="whitespace-pre-wrap rounded-card border border-border bg-page p-3 text-small text-fg">{(viewedEmail ?? viewing).body}</div>
            </div>
          )
        )}
      </Modal>
    </>
  );
}

// ---------------- Banners ----------------
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function BannerForm({ initial, onSaved, onCancel }: { initial?: BannerRow; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [message, setMessage] = useState(initial?.message ?? '');
  const [priority, setPriority] = useState(initial?.priority ?? 'default');
  const [publishAt, setPublishAt] = useState(toLocalInput(initial?.publishAt ?? null));
  const [expireAt, setExpireAt] = useState(toLocalInput(initial?.expireAt ?? null));
  const { run, busy, error } = useMutation((args: { saveAsDraft: boolean }) => {
    const body = {
      name, message, priority,
      publishAt: publishAt ? new Date(publishAt).toISOString() : undefined,
      expireAt: expireAt ? new Date(expireAt).toISOString() : undefined,
      saveAsDraft: args.saveAsDraft,
    };
    return initial
      ? api.put(`/api/communication-hub/banners/${initial.id}`, body)
      : api.post('/api/communication-hub/banners', body);
  });

  const submit = async (e: FormEvent, saveAsDraft: boolean) => {
    e.preventDefault();
    if (await run({ saveAsDraft })) onSaved();
  };

  return (
    <form onSubmit={(e) => submit(e, false)} className="space-y-4">
      {error && <p className="text-small text-danger-text">{error}</p>}
      <Field label="Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Message *"><textarea className="input min-h-28" required value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
      <Field label="Priority">
        <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
          {(['default', 'high'] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPriority(p)}
              className={`flex-1 py-2 text-small font-medium capitalize ${priority === p ? 'bg-surface text-fg' : 'bg-page text-fg-secondary'}`}>{p}</button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Publish Date"><input type="datetime-local" className="input" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} /></Field>
        <Field label="Expiration Date"><input type="datetime-local" className="input" value={expireAt} onChange={(e) => setExpireAt(e.target.value)} /></Field>
      </div>
      <p className="text-tiny text-fg-muted">Leave Publish Date blank to publish immediately; leave Expiration Date blank to never expire.</p>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={(e) => submit(e, true)}>Save Draft</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Publish'}</button>
      </div>
    </form>
  );
}

function BannersTab() {
  const [sub, setSub] = useState<(typeof BANNER_SUBTABS)[number]>('Published');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<BannerRow | null | 'new'>(null);
  const { data, loading, refetch } = useQuery<BannerRow[]>('/api/communication-hub/banners');
  const { run: runDelete } = useMutation((id: string) => api.del(`/api/communication-hub/banners/${id}`));

  const filterKey = sub === 'Published' ? 'published' : sub === 'Scheduled' ? 'scheduled' : sub === 'Expired' ? 'expired' : 'draft';
  const rows = useMemo(() => (data ?? []).filter((b) => b.status === filterKey), [data, filterKey]);
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <SubTabs tabs={BANNER_SUBTABS} active={sub} onChange={(t) => { setSub(t); setPage(1); }} />
      <Toolbar>
        <span />
        <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setEditing('new')}><Plus size={14} /> Create Partner Banner</button>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : rows.length === 0 ? (
        <StateBlock>No Record Found</StateBlock>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-small">
            <thead className="bg-page text-tiny text-fg-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Priority</th>
                <th className="px-3 py-2 text-left">Published</th>
                <th className="px-3 py-2 text-left">Expiration</th>
                <th className="px-3 py-2 text-left">Modified</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {paged.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="px-3 py-2 text-fg">{b.name}</td>
                  <td className="px-3 py-2 capitalize text-fg-secondary">{b.priority}</td>
                  <td className="px-3 py-2 text-fg-secondary">{fmt(b.publishAt)}</td>
                  <td className="px-3 py-2 text-fg-secondary">{fmt(b.expireAt)}</td>
                  <td className="px-3 py-2 text-fg-secondary">{fmt(b.updatedAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button title="Edit" className="rounded p-1 text-fg-secondary hover:bg-accent-subtle hover:text-fg" onClick={() => setEditing(b)}><Pencil size={14} /></button>
                      <button title="Delete" className="rounded p-1 text-fg-secondary hover:bg-danger-subtle hover:text-danger-text" onClick={async () => { if (await runDelete(b.id)) refetch(); }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3"><Pagination total={rows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Create Partner Banner' : 'Edit Partner Banner'}>
        <BannerForm initial={editing && editing !== 'new' ? editing : undefined} onSaved={() => { setEditing(null); refetch(); }} onCancel={() => setEditing(null)} />
      </Modal>
    </>
  );
}

// ---------------- Audiences ----------------
const STATUS_OPTIONS = ['active', 'pending', 'inactive'] as const;

function AudienceForm({ initial, onSaved, onCancel }: { initial?: AudienceRow; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [groupType, setGroupType] = useState<'publishers' | 'advertisers'>(initial?.groupType ?? 'publishers');
  const [statusFilter, setStatusFilter] = useState<string[]>(initial?.statusFilter ?? []);
  const [tierId, setTierId] = useState(initial?.tierId ?? '');
  const { data: tiers } = useQuery<Tier[]>(groupType === 'publishers' ? '/api/partner-tiers' : null);
  const { run, busy, error } = useMutation((body: Record<string, unknown>) =>
    initial ? api.put(`/api/communication-hub/audiences/${initial.id}`, body) : api.post('/api/communication-hub/audiences', body));

  const toggle = (s: string) => setStatusFilter((f) => f.includes(s) ? f.filter((x) => x !== s) : [...f, s]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run({ name, groupType, statusFilter, tierId: tierId || undefined })) onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-small text-danger-text">{error}</p>}
      <Field label="Audience Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Audience Group">
        <div className="flex overflow-hidden rounded-[var(--radius)] border border-border">
          {(['publishers', 'advertisers'] as const).map((g) => (
            <button key={g} type="button" onClick={() => { setGroupType(g); setTierId(''); }}
              className={`flex-1 py-2 text-small font-medium capitalize ${groupType === g ? 'bg-surface text-fg' : 'bg-page text-fg-secondary'}`}>
              {g === 'publishers' ? 'Partners' : 'Advertisers'}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Status (leave blank for any)">
        <div className="flex gap-3">
          {STATUS_OPTIONS.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-1.5 text-small text-fg capitalize">
              <input type="checkbox" className="chk" checked={statusFilter.includes(s)} onChange={() => toggle(s)} /> {s}
            </label>
          ))}
        </div>
      </Field>
      {groupType === 'publishers' && tiers && tiers.length > 0 && (
        <Field label="Partner Tier (optional)">
          <select className="input" value={tierId} onChange={(e) => setTierId(e.target.value)}>
            <option value="">Any tier</option>
            {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Audience'}</button>
      </div>
    </form>
  );
}

function AudiencesTab() {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AudienceRow | null | 'new'>(null);
  const { data, loading, refetch } = useQuery<AudienceRow[]>('/api/communication-hub/audiences');
  const { run: runDelete } = useMutation((id: string) => api.del(`/api/communication-hub/audiences/${id}`));
  const rows = data ?? [];
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <Toolbar>
        <span />
        <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setEditing('new')}><Plus size={14} /> Create Audience</button>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : rows.length === 0 ? (
        <StateBlock>No Record Found</StateBlock>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-small">
            <thead className="bg-page text-tiny text-fg-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Audience Group</th>
                <th className="px-3 py-2 text-left">Recipients</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {paged.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-2 text-fg">{a.name}</td>
                  <td className="px-3 py-2 capitalize text-fg-secondary">{a.groupType === 'publishers' ? 'Partners' : 'Advertisers'}</td>
                  <td className="px-3 py-2 text-fg-secondary">{a.recipientCount}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button title="Edit" className="rounded p-1 text-fg-secondary hover:bg-accent-subtle hover:text-fg" onClick={() => setEditing(a)}><Pencil size={14} /></button>
                      <button title="Delete" className="rounded p-1 text-fg-secondary hover:bg-danger-subtle hover:text-danger-text" onClick={async () => { if (await runDelete(a.id)) refetch(); }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3"><Pagination total={rows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Create Audience' : 'Edit Audience'}>
        <AudienceForm initial={editing && editing !== 'new' ? editing : undefined} onSaved={() => { setEditing(null); refetch(); }} onCancel={() => setEditing(null)} />
      </Modal>
    </>
  );
}

// ---------------- Templates ----------------
function TemplateForm({ initial, onSaved, onCancel }: { initial?: TemplateRow; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [messageType, setMessageType] = useState(initial?.messageType ?? 'general');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const { run, busy, error } = useMutation((b: Record<string, unknown>) =>
    initial ? api.put(`/api/communication-hub/templates/${initial.id}`, b) : api.post('/api/communication-hub/templates', b));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run({ name, messageType, subject, body })) onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-small text-danger-text">{error}</p>}
      <Field label="Template Name *"><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Message Type">
        <select className="input" value={messageType} onChange={(e) => setMessageType(e.target.value)}>
          <option value="general">General</option>
          <option value="offer_details">Offer Details</option>
        </select>
      </Field>
      <Field label="Subject *"><input className="input" required value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <Field label="Message *"><textarea className="input min-h-40" required value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Template'}</button>
      </div>
    </form>
  );
}

function TemplatesTab() {
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TemplateRow | null | 'new'>(null);
  const { data, loading, refetch } = useQuery<TemplateRow[]>('/api/communication-hub/templates');
  const { run: runDelete } = useMutation((id: string) => api.del(`/api/communication-hub/templates/${id}`));
  const rows = data ?? [];
  const paged = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <Toolbar>
        <span />
        <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setEditing('new')}><Plus size={14} /> Create Template</button>
      </Toolbar>
      {loading ? <StateBlock><Spinner /></StateBlock> : rows.length === 0 ? (
        <StateBlock>No Record Found</StateBlock>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full text-small">
            <thead className="bg-page text-tiny text-fg-secondary">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Subject</th>
                <th className="px-3 py-2 text-left">Modified</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {paged.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-3 py-2 text-fg">{t.name}</td>
                  <td className="px-3 py-2 capitalize text-fg-secondary">{t.messageType.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-fg-secondary">{t.subject}</td>
                  <td className="px-3 py-2 text-fg-secondary">{fmt(t.updatedAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button title="Edit" className="rounded p-1 text-fg-secondary hover:bg-accent-subtle hover:text-fg" onClick={() => setEditing(t)}><Pencil size={14} /></button>
                      <button title="Delete" className="rounded p-1 text-fg-secondary hover:bg-danger-subtle hover:text-danger-text" onClick={async () => { if (await runDelete(t.id)) refetch(); }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3"><Pagination total={rows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} /></div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Create Template' : 'Edit Template'} size="xl">
        <TemplateForm initial={editing && editing !== 'new' ? editing : undefined} onSaved={() => { setEditing(null); refetch(); }} onCancel={() => setEditing(null)} />
      </Modal>
    </>
  );
}

// ---------------- Settings (Automated System Emails) ----------------
function SystemEmailRow({ e, onToggled }: { e: SystemEmail; onToggled: () => void }) {
  const { run, busy } = useMutation((enabled: boolean) => api.put(`/api/communication-hub/system-emails/${e.key}`, { enabled }));
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{e.label}</p>
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-tiny font-medium text-fg-secondary">{e.enabled ? 'Enabled' : 'Disabled'}</span>
        <button disabled={busy} onClick={async () => { if (await run(!e.enabled)) onToggled(); }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${e.enabled ? 'bg-success' : 'bg-border'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${e.enabled ? 'right-0.5' : 'left-0.5'}`} />
        </button>
      </div>
    </div>
  );
}

function SettingsTab() {
  const { data, loading, refetch } = useQuery<SystemEmail[]>('/api/communication-hub/system-emails');
  if (loading || !data) return <StateBlock><Spinner /></StateBlock>;
  const byCategory = (cat: string) => data.filter((e) => e.category === cat);
  return (
    <div className="space-y-4">
      <p className="text-tiny text-fg-secondary">
        These reflect real events this app can already fire on (Partner sign-up, Offer Applications, Offer Creatives, Invoices,
        Postbacks, Alerts). The toggle is saved for real; wiring an actual send into every one of these action handlers is a
        larger follow-up, so toggling doesn't send anything yet.
      </p>
      {(['partner', 'advertiser', 'misc'] as const).map((cat) => (
        <div key={cat} className="card !p-0">
          <div className="border-b border-border px-4 py-3"><h3 className="text-h3 font-medium capitalize text-fg">{cat} ({byCategory(cat).length})</h3></div>
          <div className="divide-y divide-border">
            {byCategory(cat).map((e) => <SystemEmailRow key={e.key} e={e} onToggled={refetch} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

const TITLES: Record<string, string> = {
  Overview: 'Communication Hub',
  Emails: 'Manage Email Messages',
  Banners: 'Manage Partner Banners',
  Audiences: 'Manage Audiences',
  Templates: 'Manage Templates',
  Settings: 'Manage Automated System Emails',
};

export default function CommunicationHub() {
  const [tab, setTab] = useState<(typeof TOP_TABS)[number]>('Overview');
  return (
    <>
      <PageHeader title={TITLES[tab] ?? tab} subtitle={`Communication Hub${tab === 'Overview' ? '' : ` › ${tab}`}`} />
      <Tabs tabs={[...TOP_TABS]} active={tab} onChange={(t) => setTab(t as (typeof TOP_TABS)[number])} />
      {tab === 'Overview' && <OverviewTab goto={setTab} />}
      {tab === 'Emails' && <EmailsTab />}
      {tab === 'Banners' && <BannersTab />}
      {tab === 'Audiences' && <AudiencesTab />}
      {tab === 'Templates' && <TemplatesTab />}
      {tab === 'Settings' && <SettingsTab />}
    </>
  );
}
