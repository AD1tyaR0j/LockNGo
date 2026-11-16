'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { AdminOutlet } from '@sl/shared';
import { DataState, SimBadge, StatusBadge } from '@/components/ui';
import { adminFetch, ApiError, useAdminData } from '@/lib/client';

function CreateOutletForm({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const is24x7 = f.get('is24x7') === 'on';
    setBusy(true);
    setError(null);
    try {
      await adminFetch('admin/outlets', {
        method: 'POST',
        body: {
          name: f.get('name'),
          address: f.get('address'),
          city: f.get('city'),
          state: f.get('state'),
          postalCode: f.get('postalCode'),
          latitude: Number(f.get('latitude')),
          longitude: Number(f.get('longitude')),
          operatingHours: {
            open: is24x7 ? '00:00' : f.get('open'),
            close: is24x7 ? '00:00' : f.get('close'),
            is24x7,
          },
          status: 'DRAFT',
        },
      });
      (e.target as HTMLFormElement).reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create outlet');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>New outlet</h2>
      <p className="muted">New outlets start as DRAFT and are not visible to customers until activated.</p>
      <div className="form-grid">
        <label>Name<input name="name" required maxLength={160} /></label>
        <label>Address<input name="address" required maxLength={500} /></label>
        <label>City<input name="city" required /></label>
        <label>State<input name="state" required /></label>
        <label>PIN code<input name="postalCode" required pattern="\d{6}" inputMode="numeric" /></label>
        <label>Latitude<input name="latitude" required type="number" step="any" min={-90} max={90} /></label>
        <label>Longitude<input name="longitude" required type="number" step="any" min={-180} max={180} /></label>
        <label>Opens (IST)<input name="open" type="time" defaultValue="08:00" /></label>
        <label>Closes (IST)<input name="close" type="time" defaultValue="22:00" /></label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input name="is24x7" type="checkbox" style={{ minHeight: 0 }} /> Open 24×7
        </label>
      </div>
      {error ? <div className="alert error" role="alert">{error}</div> : null}
      <div>
        <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create outlet'}</button>
      </div>
    </form>
  );
}

export default function OutletsPage() {
  const { data, error, loading, reload } = useAdminData<{ items: AdminOutlet[] }>('admin/outlets');
  const [showForm, setShowForm] = useState(false);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Outlets</h1>
          <p className="muted">All outlets, including drafts and suspended sites.</p>
        </div>
        <button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Close form' : 'New outlet'}</button>
      </div>
      {showForm ? (
        <CreateOutletForm
          onCreated={() => {
            setShowForm(false);
            void reload();
          }}
        />
      ) : null}
      <div className="card">
        <DataState loading={loading} error={error} empty={!data?.items.length} emptyText="No outlets yet." onRetry={reload}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>City</th>
                  <th>Hours</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/outlets/${o.id}`}>{o.name}</Link> <SimBadge simulated={o.hasSimulatedDevices} />
                      <div className="muted">{o.address}</div>
                    </td>
                    <td>{o.city}, {o.state}</td>
                    <td>{o.operatingHours.is24x7 ? '24×7' : `${o.operatingHours.open}–${o.operatingHours.close}`}</td>
                    <td><StatusBadge status={o.status} /></td>
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
