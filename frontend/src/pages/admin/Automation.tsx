/**
 * Automation (Everflow-style): Scheduled Actions, Alerts (rule config), and Webhooks. No backend
 * concept exists for any of the three — the reference's own Webhooks tab is already "No Record
 * Found", and Scheduled Actions / Alert rules have no equivalent here either, so all three render
 * as honest shells. Note this "Alerts" tab is rule *configuration* (conditions → notify), a
 * different concept from the real Alerts inbox at /app/alerts (fraud-scan anomalies) — kept separate.
 */
import { useState } from 'react';
import { PageHeader, Tabs } from '../../components/ui';
import { EmptyShellTable } from '../../components/EmptyShellTable';

const TOP_TABS = ['Scheduled Actions', 'Alerts', 'Webhooks'] as const;

const SCHEDULED_ACTION_COLUMNS = [
  'ID', 'Type', 'Offers', 'Offer Groups', 'Partners', 'Creatives', 'Event',
  'Scheduled Time', 'Internal Notes', 'Created By', 'Created', 'Modified',
];
const ALERT_RULE_COLUMNS = ['ID', 'Name', 'Conditions', 'In App', 'Email', 'Created', 'Modified'];
const WEBHOOK_COLUMNS = ['Name', 'Events', 'HTTP Method', 'URL', 'Created', 'Modified'];

const TITLES: Record<string, string> = {
  'Scheduled Actions': 'Manage Scheduled Actions',
  Alerts: 'Manage Alerts',
  Webhooks: 'Manage Webhooks',
};

export default function Automation() {
  const [tab, setTab] = useState<string>('Scheduled Actions');
  return (
    <>
      <PageHeader title={TITLES[tab] ?? tab} subtitle={`Automation › ${tab}`} />
      <Tabs tabs={[...TOP_TABS]} active={tab} onChange={setTab} />
      {tab === 'Scheduled Actions' && <EmptyShellTable addLabel="Action" status="All" columns={SCHEDULED_ACTION_COLUMNS} />}
      {tab === 'Alerts' && <EmptyShellTable addLabel="Alert" status="Active" columns={ALERT_RULE_COLUMNS} />}
      {tab === 'Webhooks' && <EmptyShellTable addLabel="Webhook" status="Active" columns={WEBHOOK_COLUMNS} />}
    </>
  );
}
