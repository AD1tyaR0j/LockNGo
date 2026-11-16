'use client';

import Link from 'next/link';
import type { AdminDevice } from '@sl/shared';
import { DataState, SimBadge, StatusBadge } from '@/components/ui';
import { formatTime, useAdminData } from '@/lib/client';

type Row = AdminDevice & { lockerBankLabel: string; outlet: { id: string; name: string } };

export default function DevicesPage() {
  const { data, error, loading, reload } = useAdminData<{ items: Row[] }>('admin/devices');
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Devices</h1>
          <p className="muted">
            Status reflects the last heartbeat the API received. Devices go OFFLINE after missed
            heartbeats.
          </p>
        </div>
        <button onClick={reload} disabled={loading}>
          Refresh
        </button>
      </div>
      <div className="card">
        <DataState
          loading={loading}
          error={error}
          empty={!data?.items.length}
          emptyText="No devices registered."
          onRetry={reload}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Outlet / bank</th>
                  <th>Model · firmware</th>
                  <th>Status</th>
                  <th>Last heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="mono">{d.deviceIdentifier}</span>{' '}
                      <SimBadge simulated={d.isSimulated} />
                    </td>
                    <td>
                      <Link href={`/outlets/${d.outlet.id}`}>{d.outlet.name}</Link> ·{' '}
                      {d.lockerBankLabel}
                    </td>
                    <td>
                      {d.hardwareModel} · <span className="mono">{d.firmwareVersion}</span>
                    </td>
                    <td>
                      <StatusBadge status={d.status} />
                    </td>
                    <td>{formatTime(d.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </div>
  );
}
