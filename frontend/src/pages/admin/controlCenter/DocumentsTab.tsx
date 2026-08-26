import { EmptyShellTable } from '../../../components/EmptyShellTable';

export default function DocumentsTab() {
  return <EmptyShellTable addLabel="Document" columns={['ID', 'Name', 'Description', 'File', 'Created', 'Modified']} />;
}
