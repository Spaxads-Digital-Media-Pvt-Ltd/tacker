/**
 * Investigator (Everflow-style): lets you target a suspect (sub ID / transaction ID / partner) and
 * pull matching click/conversion rows for review. There's no fraud-investigation engine in this app
 * at all, so this is an honest shell matching the reference's list columns — not a stand-in for real
 * investigations. Row IDs never link anywhere since the list is always empty (no backend to click into).
 */
import { PageHeader } from '../../components/ui';
import { EmptyShellTable } from '../../components/EmptyShellTable';

const COLUMNS = ['ID', 'Start Date', 'End Date', 'Target', 'Entries', 'Suspects', 'Offers', 'Partners', 'File', 'Investigation Date'];

export default function Investigator() {
  return (
    <>
      <PageHeader title="Manage Investigations" subtitle="Investigator" />
      <EmptyShellTable addLabel="Investigation" columns={COLUMNS} />
    </>
  );
}
