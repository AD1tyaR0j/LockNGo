'use client';

import Link from 'next/link';
import { DataState } from '@/components/ui';
import { formatTime, useAdminData } from '@/lib/client';

interface Overview {
  generatedAt: string;
  outlets: Record<string, number>;
  devices: { byStatus: Record<string, number>; simulated: number; physical: number };
  compartments: Record<string, number>;
  bookings: Record<string, number>;
  recentAlerts: {
    id: string;
    action: string;
    resourceType: string;
    resourceId: string | null;
    createdAt: string;
  }[];
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

function Kpi({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export default function OverviewPage() {
  const { data, error, loading, reload } = useAdminData<Overview>('admin/overview');
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Network overview</h1>
          <p className="muted">
            Live from the API{data ? ` · as of ${formatTime(data.generatedAt)}` : ''}
          </p>
        </div>
        <button onClick={reload} disabled={loading}>
          Refresh
        </button>
      </div>
      <DataState loading={loading} error={error} empty={!data} onRetry={reload}>
        {data ? (
          <>
            {data.devices.simulated > 0 ? (
              <div className="alert warn">
                {data.devices.simulated} of {data.devices.simulated + data.devices.physical} devices
                are SIMULATED. Their door and lock events come from the device simulator, not
                hardware.
              </div>
            ) : null}
            <div className="grid kpis">
              <Kpi
                label="Outlets"
                value={sum(data.outlets)}
                sub={`${data.outlets.ACTIVE ?? 0} active`}
              />
              <Kpi
                label="Devices online"
                value={`${data.devices.byStatus.ONLINE ?? 0} / ${sum(data.devices.byStatus)}`}
                sub={`${data.devices.byStatus.OFFLINE ?? 0} offline · ${data.devices.byStatus.FAULT ?? 0} fault`}
              />
              <Kpi
                label="Compartments"
                value={sum(data.compartments)}
                sub={`${data.compartments.AVAILABLE ?? 0} available now`}
              />
              <Kpi label="Reserved" value={data.compartments.RESERVED ?? 0} />
              <Kpi label="Occupied" value={data.compartments.OCCUPIED ?? 0} />
              <Kpi
                label="Out of service"
                value={
                  (data.compartments.OUT_OF_SERVICE ?? 0) +
                  (data.compartments.NEEDS_INSPECTION ?? 0)
                }
                sub={`${data.compartments.NEEDS_INSPECTION ?? 0} need inspection`}
              />
              <Kpi
                label="Active bookings"
                value={
                  (data.bookings.ACTIVE ?? 0) +
                  (data.bookings.ACCESS_READY ?? 0) +
                  (data.bookings.CONFIRMED ?? 0)
                }
                sub={`${data.bookings.PENDING_PAYMENT ?? 0} awaiting payment`}
              />
            </div>
            <div className="card">
              <h2>Recent alerts</h2>
              {data.recentAlerts.length === 0 ? (
                <p className="muted">No alerts.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Alert</th>
                        <th>Resource</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentAlerts.map((a) => (
                        <tr key={a.id}>
                          <td>{formatTime(a.createdAt)}</td>
                          <td className="mono">{a.action}</td>
                          <td>
                            <Link href={`/audit?resourceId=${a.resourceId ?? ''}`} className="mono">
                              {a.resourceType} {a.resourceId?.slice(0, 8)}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : null}
      </DataState>
    </div>
  );
}
