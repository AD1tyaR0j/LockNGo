'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { DataState } from '@/components/ui';
import { formatTime, useAdminData } from '@/lib/client';

interface Entry {
  id: string;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const PAGE = 50;

function AuditLog() {
  const sp = useSearchParams();
  const [filters, setFilters] = useState({
    action: '',
    resourceType: '',
    resourceId: sp.get('resourceId') ?? '',
  });
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  const { data, error, loading, reload } = useAdminData<{ items: Entry[]; total: number }>(`admin/audit?${params}`);

  function apply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setFilters({
      action: String(f.get('action') ?? '').trim(),
      resourceType: String(f.get('resourceType') ?? '').trim(),
      resourceId: String(f.get('resourceId') ?? '').trim(),
    });
    setOffset(0);
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Append-only record of sensitive actions. Never contains PINs, tokens or passwords.</p>
        </div>
        <button onClick={reload}>Refresh</button>
      </div>
      <form className="card form-grid" onSubmit={apply}>
        <label>Action<input name="action" placeholder="e.g. device.unlock_requested" defaultValue={filters.action} /></label>
        <label>Resource type<input name="resourceType" placeholder="e.g. compartment" defaultValue={filters.resourceType} /></label>
        <label>Resource id<input name="resourceId" defaultValue={filters.resourceId} /></label>
        <button className="primary" style={{ alignSelf: 'flex-end' }}>Filter</button>
      </form>
      <div className="card">
        <DataState loading={loading} error={error} empty={!data?.items.length} emptyText="No audit entries match." onRetry={reload}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>When</th><th>Actor</th><th>Action</th><th>Resource</th><th>Details</th></tr>
              </thead>
              <tbody>
                {data?.items.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatTime(a.createdAt)}</td>
                    <td><span className="badge b-neutral">{a.actorType}</span> <span className="mono">{a.actorId?.slice(0, 8)}</span></td>
                    <td className="mono">{a.action}</td>
                    <td className="mono">{a.resourceType} {a.resourceId?.slice(0, 8)}</td>
                    <td className="mono muted" style={{ maxWidth: 360, wordBreak: 'break-word' }}>
                      {Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data ? (
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
              <span className="muted">{data.total} entries</span>
              <div className="row">
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
                <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
              </div>
            </div>
          ) : null}
        </DataState>
      </div>
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="state">Loading…</div>}>
      <AuditLog />
    </Suspense>
  );
}
