'use client';

import { use, useState, type FormEvent } from 'react';
import type { AdminCompartment, AdminLockerBank, AdminOutlet, CompartmentSize } from '@sl/shared';
import { DataState, SimBadge, StatusBadge } from '@/components/ui';
import { adminFetch, ApiError, formatTime, useAdminData } from '@/lib/client';

interface Detail {
  outlet: AdminOutlet;
  lockerBanks: AdminLockerBank[];
}

type Action = 'DISABLE' | 'MARK_NEEDS_INSPECTION' | 'RETURN_TO_SERVICE';
const ACTIONS: Record<AdminCompartment['operationalStatus'], { action: Action; label: string }[]> =
  {
    IN_SERVICE: [
      { action: 'DISABLE', label: 'Disable' },
      { action: 'MARK_NEEDS_INSPECTION', label: 'Flag inspection' },
    ],
    NEEDS_INSPECTION: [
      { action: 'RETURN_TO_SERVICE', label: 'Return to service' },
      { action: 'DISABLE', label: 'Disable' },
    ],
    OUT_OF_SERVICE: [
      { action: 'RETURN_TO_SERVICE', label: 'Return to service' },
      { action: 'MARK_NEEDS_INSPECTION', label: 'Flag inspection' },
    ],
  };

function CompartmentCard({
  c,
  onChanged,
}: {
  c: AdminCompartment;
  onChanged: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function run(action: Action, label: string) {
    const reason = window.prompt(
      `${label} compartment ${c.code}. Reason (required, recorded in the audit log):`,
    );
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const r = await adminFetch<{
        operationalStatus: string;
        affectedBookings: { reference: string; status: string }[];
      }>(`admin/compartments/${c.id}/status`, { method: 'POST', body: { action, reason } });
      onChanged(
        `${c.code} is now ${r.operationalStatus.replaceAll('_', ' ')}.` +
          (r.affectedBookings.length
            ? ` ${r.affectedBookings.length} booking(s) need follow-up: ${r.affectedBookings.map((b) => `${b.reference} (${b.status})`).join(', ')}`
            : ''),
      );
    } catch (e) {
      onChanged(e instanceof ApiError ? `Error: ${e.message}` : 'Error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="compartment">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="code">{c.code}</span>
        <span className="muted">Size {c.size}</span>
      </div>
      <StatusBadge status={c.displayStatus} />
      <span className="muted" style={{ fontSize: 12 }}>
        Door: {c.doorState.toLowerCase()} · max {(c.maxWeightGrams / 1000).toFixed(0)} kg
      </span>
      <div className="row">
        {ACTIONS[c.operationalStatus].map((a) => (
          <button
            key={a.action}
            className={`small ${a.action === 'DISABLE' ? 'danger' : ''}`}
            disabled={busy}
            onClick={() => run(a.action, a.label)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RegisterDevice({ bank, onDone }: { bank: AdminLockerBank; onDone: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      const r = await adminFetch<{ deviceToken: string }>('admin/devices', {
        method: 'POST',
        body: {
          lockerBankId: bank.id,
          deviceIdentifier: f.get('deviceIdentifier'),
          hardwareModel: f.get('hardwareModel'),
          firmwareVersion: f.get('firmwareVersion'),
          isSimulated: f.get('isSimulated') === 'on',
        },
      });
      setToken(r.deviceToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    }
  }
  if (token) {
    return (
      <div className="alert warn stack">
        <strong>
          Device token — shown once. Store it in the device&apos;s secure provisioning store now.
        </strong>
        <code className="mono" style={{ wordBreak: 'break-all' }}>
          {token}
        </code>
        <span>
          For the simulator: SIM_DEVICE_ID=&lt;identifier&gt; SIM_DEVICE_TOKEN=&lt;token&gt; pnpm
          sim
        </span>
        <div>
          <button onClick={onDone}>I have stored it</button>
        </div>
      </div>
    );
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Device identifier
          <input name="deviceIdentifier" required pattern="[A-Za-z0-9._-]{3,64}" />
        </label>
        <label>
          Hardware model
          <input name="hardwareModel" required defaultValue="SIMULATOR" />
        </label>
        <label>
          Firmware
          <input name="firmwareVersion" required defaultValue="sim-0.1.0" />
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input name="isSimulated" type="checkbox" defaultChecked style={{ minHeight: 0 }} />{' '}
          Simulated device
        </label>
      </div>
      {error ? <div className="alert error">{error}</div> : null}
      <div>
        <button className="primary">Register device</button>
      </div>
    </form>
  );
}

function AddLockerBank({ outletId, onDone }: { outletId: string; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    const layout = String(f.get('layout') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const [code, size, kg] = entry.split(':');
        return {
          code: code?.toUpperCase() ?? '',
          size: (size?.toUpperCase() ?? 'S') as CompartmentSize,
          maxWeightGrams: Number(kg ?? 10) * 1000,
        };
      });
    try {
      await adminFetch(`admin/outlets/${outletId}/locker-banks`, {
        method: 'POST',
        body: { label: f.get('label'), model: f.get('model'), compartments: layout },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Add locker bank</h2>
      <div className="form-grid">
        <label>
          Label
          <input name="label" required maxLength={60} defaultValue="B" />
        </label>
        <label>
          Model
          <input name="model" required defaultValue="SIMULATED-10" />
        </label>
      </div>
      <label>
        Compartments (code:size:max-kg, comma separated)
        <input name="layout" defaultValue="S1:S:5, S2:S:5, M1:M:15, L1:L:25" />
      </label>
      {error ? <div className="alert error">{error}</div> : null}
      <div>
        <button className="primary">Create locker bank</button>
      </div>
    </form>
  );
}

export default function OutletDetailPage({ params }: { params: Promise<{ outletId: string }> }) {
  const { outletId } = use(params);
  const { data, error, loading, reload } = useAdminData<Detail>(`admin/outlets/${outletId}`);
  const [message, setMessage] = useState<string | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const [addingBank, setAddingBank] = useState(false);

  async function setStatus(status: 'ACTIVE' | 'SUSPENDED' | 'DRAFT') {
    if (!window.confirm(`Set outlet status to ${status}?`)) return;
    try {
      await adminFetch(`admin/outlets/${outletId}`, { method: 'PATCH', body: { status } });
      setMessage(`Outlet is now ${status}.`);
      void reload();
    } catch (e) {
      setMessage(e instanceof ApiError ? `Error: ${e.message}` : 'Error');
    }
  }

  return (
    <DataState loading={loading} error={error} empty={!data} onRetry={reload}>
      {data ? (
        <div className="stack">
          <div className="page-head">
            <div>
              <h1>
                {data.outlet.name} <SimBadge simulated={data.outlet.hasSimulatedDevices} />
              </h1>
              <p className="muted">
                {data.outlet.address}, {data.outlet.city} {data.outlet.postalCode} ·{' '}
                {data.outlet.operatingHours.is24x7
                  ? 'Open 24×7'
                  : `Open ${data.outlet.operatingHours.open}–${data.outlet.operatingHours.close} IST`}
              </p>
            </div>
            <div className="row">
              <StatusBadge status={data.outlet.status} />
              {data.outlet.status !== 'ACTIVE' ? (
                <button onClick={() => setStatus('ACTIVE')}>Activate</button>
              ) : null}
              {data.outlet.status === 'ACTIVE' ? (
                <button className="danger" onClick={() => setStatus('SUSPENDED')}>
                  Suspend
                </button>
              ) : null}
              <button onClick={reload}>Refresh</button>
            </div>
          </div>
          {message ? (
            <div className={`alert ${message.startsWith('Error') ? 'error' : 'ok'}`} role="status">
              {message}
            </div>
          ) : null}
          {data.lockerBanks.length === 0 ? (
            <div className="card state">No locker banks yet.</div>
          ) : null}
          {data.lockerBanks.map((bank) => (
            <section key={bank.id} className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>
                  Locker bank {bank.label} <span className="muted">· {bank.model}</span>
                </h2>
                {bank.device ? (
                  <div className="row">
                    <span className="mono">{bank.device.deviceIdentifier}</span>
                    <StatusBadge status={bank.device.status} />
                    <SimBadge simulated={bank.device.isSimulated} />
                    <span className="muted">last seen {formatTime(bank.device.lastSeenAt)}</span>
                  </div>
                ) : (
                  <button onClick={() => setRegistering(bank.id)}>Register device</button>
                )}
              </div>
              {!bank.device && registering === bank.id ? (
                <RegisterDevice
                  bank={bank}
                  onDone={() => {
                    setRegistering(null);
                    void reload();
                  }}
                />
              ) : null}
              {!bank.device ? (
                <div className="alert warn">
                  No controller registered: compartments in this bank cannot be booked.
                </div>
              ) : null}
              <div className="compartments">
                {bank.compartments.map((c) => (
                  <CompartmentCard
                    key={c.id}
                    c={c}
                    onChanged={(m) => {
                      setMessage(m);
                      void reload();
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
          {addingBank ? (
            <AddLockerBank
              outletId={outletId}
              onDone={() => {
                setAddingBank(false);
                void reload();
              }}
            />
          ) : (
            <div>
              <button onClick={() => setAddingBank(true)}>Add locker bank</button>
            </div>
          )}
        </div>
      ) : null}
    </DataState>
  );
}
