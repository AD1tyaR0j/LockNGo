'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { BOOKING_STATUSES } from '@sl/shared/constants';
import { DataState, StatusBadge } from '@/components/ui';
import { formatInr, formatTime, useAdminData } from '@/lib/client';

interface Row {
  id: string;
  reference: string;
  status: string;
  startsAt: string;
  expiresAt: string;
  amountMinor: number;
  outletName: string;
  compartmentCode: string;
}

const PAGE = 25;

export default function BookingsPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const { data, error, loading, reload } = useAdminData<{ items: Row[]; total: number }>(
    `admin/bookings?${params}`,
  );

  function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setQ(String(f.get('q') ?? '').trim());
    setStatus(String(f.get('status') ?? ''));
    setOffset(0);
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Storage bookings</h1>
          <p className="muted">Opening a booking is recorded in the audit log.</p>
        </div>
      </div>
      <form className="card row" onSubmit={search}>
        <label style={{ flex: 1, minWidth: 200 }}>
          Booking reference
          <input name="q" placeholder="SLB-…" defaultValue={q} />
        </label>
        <label>
          Status
          <select name="status" defaultValue={status}>
            <option value="">Any</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" style={{ alignSelf: 'flex-end' }}>
          Search
        </button>
      </form>
      <div className="card">
        <DataState
          loading={loading}
          error={error}
          empty={!data?.items.length}
          emptyText="No bookings match."
          onRetry={reload}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Outlet · compartment</th>
                  <th>Window</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/bookings/${b.id}`} className="mono">
                        {b.reference}
                      </Link>
                    </td>
                    <td>
                      {b.outletName} · <span className="mono">{b.compartmentCode}</span>
                    </td>
                    <td>
                      {formatTime(b.startsAt)} → {formatTime(b.expiresAt)}
                    </td>
                    <td>{formatInr(b.amountMinor)}</td>
                    <td>
                      <StatusBadge status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data ? (
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
              <span className="muted">
                {offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}
              </span>
              <div className="row">
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  Previous
                </button>
                <button
                  disabled={offset + PAGE >= data.total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </DataState>
      </div>
    </div>
  );
}
