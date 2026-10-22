/**
 * Super Admin › Sales › Team & quotas — for a month: each salesperson's quota (new MRR to win), what they won,
 * how far along they are, and the commission their networks' payments earned; their commission plan
 * (a % for the first N months, or for good) and a 12-month statement with the invoices behind each month.
 * Setting quotas and plans is a team manager's (team:full); a salesperson without team access sees their own row.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useMutation, useQuery } from '../../../lib/useApi';
import { money } from '../../../lib/platformBilling';
import type { CommissionMonth, SalesTeamMember } from '../../../lib/platformSales';
import { Field, Modal, PageHeader, Spinner, StateBlock, Table, type Column } from '../../../shared-components/primitives/ui';
import { Avatar } from '../kit';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
/** % of target as a whole number (text amounts, so compare in cents). */
const percentOf = (won: string, target: string) => {
  const t = Math.round(Number(target) * 100);
  return t > 0 ? Math.round((Math.round(Number(won) * 100) / t) * 100) : null;
};
const planLabel = (c: SalesTeamMember['comp']) => (c ? `${Number(c.commissionPct)}%${c.commissionMonths ? ` · first ${c.commissionMonths} mo` : ' · ongoing'}` : 'No plan');

function QuotaForm({ member, month, onClose, onSaved }: { member: SalesTeamMember; month: string; onClose: () => void; onSaved: () => void }) {
  const [currency, setCurrency] = useState(member.quota[0]?.currency ?? 'USD');
  const [target, setTarget] = useState(member.quota[0]?.target ?? '');
  const save = useMutation((b: { target: string | null }) => api.put('/platform/sales/quotas', { adminId: member.id, month, currency: currency.trim().toUpperCase(), ...b }));
  return (
    <Modal open onClose={onClose} title={`${member.name} · quota for ${monthLabel(month)}`}
      footer={<>
        {member.quota.some((q) => q.currency === currency.toUpperCase()) && <button type="button" className="btn-ghost mr-auto text-danger-text" disabled={save.busy} onClick={async () => { if (await save.run({ target: null })) onSaved(); }}>Remove</button>}
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={save.busy || !target.trim()} onClick={async () => { if (await save.run({ target: target.trim() })) onSaved(); }}>{save.busy ? 'Saving…' : 'Save quota'}</button>
      </>}>
      <div className="space-y-3">
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <p className="text-small text-fg-secondary">New monthly recurring revenue to win this month — the expected MRR of the leads they win.</p>
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <Field label="Currency"><input className="input font-mono uppercase" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
          <Field label="Target (MRR)"><input className="input font-mono" inputMode="decimal" placeholder="5000" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function CompPlanForm({ member, onClose, onSaved }: { member: SalesTeamMember; onClose: () => void; onSaved: () => void }) {
  const [pct, setPct] = useState(member.comp ? String(Number(member.comp.commissionPct)) : '10');
  const [months, setMonths] = useState(member.comp?.commissionMonths ? String(member.comp.commissionMonths) : '12');
  const [ongoing, setOngoing] = useState(member.comp ? member.comp.commissionMonths === null : false);
  const save = useMutation(() => api.put(`/platform/sales/comp-plans/${member.id}`, { commissionPct: pct.trim(), commissionMonths: ongoing ? null : Number(months) }));
  return (
    <Modal open onClose={onClose} title={`${member.name} · commission plan`}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={save.busy} onClick={async () => { if (await save.run(undefined)) onSaved(); }}>{save.busy ? 'Saving…' : 'Save plan'}</button></>}>
      <div className="space-y-3">
        {save.error && <p className="text-small text-danger-text">{save.error}</p>}
        <p className="text-small text-fg-secondary">A share of what the networks they sold pay (paid invoices), worked out per month and currency.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Commission %"><input className="input" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
          <Field label="For the first … months"><input className="input" inputMode="numeric" disabled={ongoing} value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-small text-fg"><input type="checkbox" className="h-4 w-4" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} /> For as long as the network pays</label>
      </div>
    </Modal>
  );
}

function Statement({ member, onClose }: { member: SalesTeamMember; onClose: () => void }) {
  const st = useQuery<{ comp: SalesTeamMember['comp']; statement: CommissionMonth[] }>(`/platform/sales/commissions/${member.id}`);
  const [month, setMonth] = useState<string | null>(null);
  const invoices = useQuery<{ id: string; number: string; network_id: string; network_name: string; currency: string; paid_amount: string; paid_at: string; commission: string }[]>(
    month ? `/platform/sales/commissions/${member.id}/${month}` : null);
  return (
    <Modal open onClose={onClose} title={`${member.name} · commission statement`} size="xl">
      {st.loading && !st.data ? <StateBlock><Spinner /></StateBlock> : st.error || !st.data ? <StateBlock>{st.error ?? 'Could not load the statement'}</StateBlock> : (
        <div className="space-y-4">
          <p className="text-small text-fg-secondary">Plan: <span className="font-medium text-fg">{planLabel(st.data.comp)}</span> — the last 12 months, by the month an invoice was paid (UTC).</p>
          {st.data.statement.length === 0 ? <p className="text-small text-fg-muted">No commission yet{st.data.comp ? ' — none of their networks has paid in this window.' : ' — they have no commission plan.'}</p> : (
            <Table rowKey={(r) => `${r.month}-${r.currency}`} rows={st.data.statement} columns={[
              { header: 'Month', cell: (r) => <button className="font-medium text-accent-text hover:underline" onClick={() => setMonth(r.month)}>{monthLabel(r.month)}</button> },
              { header: 'Paid by their networks', cell: (r) => money(r.paid, r.currency) },
              { header: 'Invoices', cell: (r) => r.invoices },
              { header: 'Commission', cell: (r) => <span className="font-medium">{money(r.commission, r.currency)}</span> },
            ]} />
          )}
          {month && (
            <div className="space-y-2">
              <h4 className="text-small font-semibold text-fg">{monthLabel(month)} · invoices</h4>
              {invoices.loading && !invoices.data ? <Spinner /> : (
                <Table rowKey={(i) => i.id} rows={invoices.data ?? []} columns={[
                  { header: 'Invoice', cell: (i) => <Link className="font-mono text-accent-text hover:underline" to={`/admin/invoices/${i.id}`}>{i.number}</Link> },
                  { header: 'Network', cell: (i) => <Link className="hover:underline" to={`/admin/networks/${i.network_id}`}>{i.network_name}</Link> },
                  { header: 'Paid', cell: (i) => `${money(i.paid_amount, i.currency)} · ${new Date(i.paid_at).toLocaleDateString()}` },
                  { header: 'Commission', cell: (i) => money(i.commission, i.currency) },
                ]} />
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function SalesTeam() {
  const [month, setMonth] = useState(thisMonth());
  const team = useQuery<{ month: string; canManage: boolean; members: SalesTeamMember[] }>('/platform/sales/team', { month });
  const [quotaFor, setQuotaFor] = useState<SalesTeamMember | null>(null);
  const [planFor, setPlanFor] = useState<SalesTeamMember | null>(null);
  const [statementFor, setStatementFor] = useState<SalesTeamMember | null>(null);
  const manage = team.data?.canManage ?? false;
  const columns: Column<SalesTeamMember>[] = [
    { header: 'Salesperson', cell: (m) => <span className="inline-flex items-center gap-2"><Avatar name={m.name} size="sm" /><span><span className="block font-medium">{m.name}</span><span className="text-tiny text-fg-muted">{m.role_name}</span></span></span> },
    {
      header: 'Quota', cell: (m) => (
        <span className="inline-flex items-center gap-2">
          <span>{m.quota.length ? m.quota.map((q) => money(q.target, q.currency)).join(' · ') : <span className="text-fg-muted">—</span>}</span>
          {manage && <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setQuotaFor(m)}>{m.quota.length ? 'Edit' : 'Set'}</button>}
        </span>
      ),
    },
    { header: 'Won', cell: (m) => (m.won.length ? m.won.map((w) => <span key={w.currency} className="block">{money(w.amount, w.currency)} <span className="text-tiny text-fg-muted">· {w.deals} deal{w.deals === 1 ? '' : 's'}</span></span>) : <span className="text-fg-muted">—</span>) },
    {
      header: 'Attainment', cell: (m) => (m.quota.length ? (
        <div className="min-w-[9rem] space-y-1">
          {m.quota.map((q) => {
            const p = percentOf(m.won.find((w) => w.currency === q.currency)?.amount ?? '0', q.target) ?? 0;
            return (
              <div key={q.currency}>
                <div className="flex justify-between text-tiny"><span className="text-fg-muted">{q.currency}</span><span className={p >= 100 ? 'font-semibold text-success-text' : 'text-fg-secondary'}>{p}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-page"><div className={`h-full rounded-full ${p >= 100 ? 'bg-success' : p >= 50 ? 'bg-accent' : 'bg-warning'}`} style={{ width: `${Math.min(p, 100)}%` }} /></div>
              </div>
            );
          })}
        </div>
      ) : <span className="text-fg-muted">No quota</span>),
    },
    { header: 'Commission', cell: (m) => (m.commission.length ? m.commission.map((c) => <span key={c.currency} className="block font-medium">{money(c.amount, c.currency)}</span>) : <span className="text-fg-muted">—</span>) },
    {
      header: 'Plan', cell: (m) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <span className={m.comp ? '' : 'text-fg-muted'}>{planLabel(m.comp)}</span>
          {manage && <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setPlanFor(m)}>Edit</button>}
        </span>
      ),
    },
    { header: '', className: 'text-right', cell: (m) => <button className="text-tiny font-medium text-accent-text hover:underline" onClick={() => setStatementFor(m)}>Statement</button> },
  ];
  return (
    <>
      <PageHeader title="Team & quotas" subtitle="Quotas, what each salesperson won, and the commission their networks’ payments earned."
        action={<input type="month" className="input !w-auto" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Month" />} />
      {team.loading && !team.data ? <StateBlock><Spinner /></StateBlock>
        : team.error || !team.data ? <StateBlock>{team.error ?? 'Could not load the team'}</StateBlock>
        : team.data.members.length === 0 ? <StateBlock>No salespeople yet — give a member a role with Sales at Full (Team & roles).</StateBlock>
        : <Table columns={columns} rows={team.data.members} rowKey={(m) => m.id} />}
      {quotaFor && <QuotaForm member={quotaFor} month={month} onClose={() => setQuotaFor(null)} onSaved={() => { setQuotaFor(null); team.refetch(); }} />}
      {planFor && <CompPlanForm member={planFor} onClose={() => setPlanFor(null)} onSaved={() => { setPlanFor(null); team.refetch(); }} />}
      {statementFor && <Statement member={statementFor} onClose={() => setStatementFor(null)} />}
    </>
  );
}
