'use client';

import { use } from 'react';
import type { BookingDetail } from '@sl/shared';
import { DataState, SimBadge, StatusBadge } from '@/components/ui';
import { formatInr, formatTime, useAdminData } from '@/lib/client';

export default function BookingDetailPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = use(params);
  const {
    data: b,
    error,
    loading,
    reload,
  } = useAdminData<BookingDetail>(`admin/bookings/${bookingId}`);
  return (
    <DataState loading={loading} error={error} empty={!b} onRetry={reload}>
      {b ? (
        <div className="stack">
          <div className="page-head">
            <div>
              <h1 className="mono">{b.reference}</h1>
              <p className="muted">
                {b.outlet.name} · bank {b.compartment.lockerBankLabel} · compartment{' '}
                <span className="mono">{b.compartment.code}</span> (size {b.compartment.size}){' '}
                <SimBadge simulated={b.compartment.isSimulated} />
              </p>
            </div>
            <div className="row">
              <StatusBadge status={b.status} />
              <button onClick={reload}>Refresh</button>
            </div>
          </div>
          <div className="grid kpis">
            <div className="card kpi">
              <div className="label">Starts</div>
              <div>{formatTime(b.startsAt)}</div>
            </div>
            <div className="card kpi">
              <div className="label">Paid until</div>
              <div>{formatTime(b.expiresAt)}</div>
            </div>
            <div className="card kpi">
              <div className="label">Total</div>
              <div>{formatInr(b.total.amountMinor)}</div>
            </div>
            <div className="card kpi">
              <div className="label">Payment</div>
              <div className="row">
                {b.payment ? <StatusBadge status={b.payment.status} /> : '—'}
                {b.payment?.isMock ? <span className="badge b-sim">MOCK</span> : null}
              </div>
            </div>
          </div>
          {b.pendingCommand ? (
            <div className="alert warn">
              Unlock ({b.pendingCommand.purpose}) in progress: {b.pendingCommand.status}, expires{' '}
              {formatTime(b.pendingCommand.expiresAt)}
            </div>
          ) : null}
          <div className="card">
            <h2>Price breakdown (snapshot at booking)</h2>
            <table>
              <tbody>
                {b.breakdown.map((l) => (
                  <tr key={l.label}>
                    <td>{l.label}</td>
                    <td style={{ textAlign: 'right' }}>{formatInr(l.amountMinor)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{formatInr(b.total.amountMinor)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="card">
            <h2>Event timeline</h2>
            <ol className="timeline">
              {b.events.map((e) => (
                <li key={e.id}>
                  <div className="row">
                    <strong className="mono">{e.type}</strong>
                    <span className="badge b-neutral">{e.actorType}</span>
                    <span className="muted">{formatTime(e.createdAt)}</span>
                  </div>
                  {Object.keys(e.metadata).length ? (
                    <div className="mono muted">{JSON.stringify(e.metadata)}</div>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
          <p className="muted">
            Manual unlock is intentionally not available here. Locker access requires the
            customer&apos;s authenticated request or PIN.
          </p>
        </div>
      ) : null}
    </DataState>
  );
}
