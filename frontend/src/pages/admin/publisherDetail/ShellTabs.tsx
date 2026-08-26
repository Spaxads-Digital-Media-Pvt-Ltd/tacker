import { EmptyShellTable } from '../../../components/EmptyShellTable';
import { Accordion } from '../../../components/Accordion';
import { ComingSoon } from '../../../components/ComingSoon';

export function UsersTab() {
  return <EmptyShellTable addLabel="User" columns={['ID', 'Name', 'Title', 'Work Phone', 'Cell Phone', 'Email', 'Language', 'Created', 'Modified']} />;
}

export function OfferApplicationsTab() {
  return <EmptyShellTable columns={['Offer', 'Advertiser', 'Status', 'Questionnaire', 'Request Date', 'Latest Update']} />;
}

export function TCsTab() {
  return <EmptyShellTable search={false} columns={['Date/Time', 'Offer', 'User', 'IP Address', 'User Agent']} />;
}

export function CustomSettingsTab() {
  return (
    <div className="space-y-4">
      <Accordion title="Custom Payout Revenue Settings" count={0} defaultOpen><ComingSoon /></Accordion>
      <Accordion title="Custom Caps Settings" count={0}><ComingSoon /></Accordion>
      <Accordion title="Custom Throttle Rate Settings" count={0}><ComingSoon /></Accordion>
      <Accordion title="Landing Pages" count={0}><ComingSoon /></Accordion>
      <Accordion title="Custom Creatives" count={0}><ComingSoon /></Accordion>
    </div>
  );
}

export function CouponCodesTab() {
  return <EmptyShellTable addLabel="Coupon Code" columns={['ID', 'Coupon Code', 'Offer', 'Start Date', 'End Date', 'Description', 'Created', 'Modified']} />;
}

export function ScheduledActionsTab() {
  return <EmptyShellTable addLabel="Action" columns={['ID', 'Type', 'Offers', 'Event', 'Scheduled Time', 'Internal Notes', 'Created By', 'Created', 'Modified']} />;
}

export function ApiTab() {
  return (
    <div className="space-y-4">
      <Accordion title="API Keys" count={0} defaultOpen>
        <EmptyShellTable addLabel="Add" entityName="API Key" columns={['Key', 'Created By', 'Created']} />
      </Accordion>
      <Accordion title="API IPs" count={0}>
        <EmptyShellTable search={false} columns={['IP', 'Created']} />
      </Accordion>
    </div>
  );
}

export function DocumentsTab() {
  return <EmptyShellTable addLabel="Document" columns={['ID', 'Name', 'Description', 'File', 'Created', 'Modified']} />;
}

export function TrackingDomainsTab() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="card !p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-h3 font-medium text-fg">Partner Specific Tracking Domain</h3>
          <button title="Not available yet" className="btn-primary !py-1.5 !px-3 text-tiny">+ Add</button>
        </div>
        <p className="p-4 text-small text-fg-muted">No partner-specific tracking domain currently configured.</p>
      </div>
      <div className="card !p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-h3 font-medium text-fg">Offer / Tracking Domain</h3>
          <button title="Not available yet" className="btn-primary !py-1.5 !px-3 text-tiny">+ Add</button>
        </div>
        <div className="p-4"><EmptyShellTable search={false} columns={['Offer', 'Tracking Domain']} /></div>
      </div>
    </div>
  );
}

export function HistoryTab() {
  return <EmptyShellTable columns={['ID', 'Operation Time', 'Service', 'Changes', 'Employee', 'Method', 'Portal', 'User IP', 'User Agent']} />;
}
