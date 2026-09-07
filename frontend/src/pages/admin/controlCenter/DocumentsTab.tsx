import { useState } from 'react';
import { EmptyShellTable } from '../../../components/EmptyShellTable';
import { cc } from '../../../lib/controlCenter';
import { useQuery } from '../../../lib/useApi';

interface DocRow {
  id: string; ref: number; name: string; description: string; fileUrl: string;
  status: string; createdAt: string; updatedAt: string;
}

function statusParam(s: string) {
  return s === 'All' ? 'all' : s.toLowerCase();
}

export default function DocumentsTab() {
  const [status, setStatus] = useState('Active');
  const { data, loading, refetch } = useQuery<DocRow[]>(`/api/control-center/documents?status=${statusParam(status)}`);

  const rows = (data ?? []).map((d) => ({
    id: d.id,
    cells: {
      ID: String(d.ref),
      Name: d.name,
      Description: d.description || '—',
      File: d.fileUrl || '—',
      Created: new Date(d.createdAt).toLocaleDateString(),
      Modified: new Date(d.updatedAt).toLocaleDateString(),
    },
  }));

  return (
    <EmptyShellTable
      addLabel="Document"
      entityName="Document"
      status="Active"
      statusFilter={status}
      onStatusFilterChange={setStatus}
      columns={['ID', 'Name', 'Description', 'File', 'Created', 'Modified']}
      rows={rows}
      loading={loading}
      onAddSubmit={async (v) => {
        await cc.create('documents', {
          name: v['Name'],
          description: v['Description'] ?? '',
          fileUrl: v['File'] ?? '',
        });
        refetch();
        return true;
      }}
      onDelete={async (id) => { await cc.del('documents', id); refetch(); }}
    />
  );
}
