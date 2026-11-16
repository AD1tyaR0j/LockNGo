'use client';

import type { ReactNode } from 'react';
import type { ApiError } from '@/lib/client';

const TONE: Record<string, string> = {
  // bookings
  PENDING_PAYMENT: 'b-warn',
  CONFIRMED: 'b-info',
  ACCESS_READY: 'b-info',
  ACTIVE: 'b-ok',
  COMPLETED: 'b-neutral',
  CANCELLED: 'b-neutral',
  EXPIRED: 'b-neutral',
  DISPUTED: 'b-danger',
  // compartments
  AVAILABLE: 'b-ok',
  RESERVED: 'b-info',
  OCCUPIED: 'b-warn',
  IN_SERVICE: 'b-ok',
  NEEDS_INSPECTION: 'b-danger',
  OUT_OF_SERVICE: 'b-danger',
  // devices
  ONLINE: 'b-ok',
  OFFLINE: 'b-danger',
  PROVISIONED: 'b-neutral',
  FAULT: 'b-danger',
  DECOMMISSIONED: 'b-neutral',
  // outlets
  DRAFT: 'b-neutral',
  SUSPENDED: 'b-danger',
  // payments
  CREATED: 'b-warn',
  CAPTURED: 'b-ok',
  FAILED: 'b-danger',
  REFUND_REQUIRED: 'b-danger',
  REFUNDED: 'b-neutral',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${TONE[status] ?? 'b-neutral'}`}>{status.replaceAll('_', ' ')}</span>
  );
}

export function SimBadge({
  simulated,
  label = 'SIMULATED',
}: {
  simulated: boolean;
  label?: string;
}) {
  if (!simulated) return null;
  return (
    <span
      className="badge b-sim"
      title="No physical hardware: events come from the device simulator"
    >
      {label}
    </span>
  );
}

export function DataState({
  loading,
  error,
  empty,
  emptyText = 'Nothing here yet.',
  onRetry,
  children,
}: {
  loading: boolean;
  error: ApiError | null;
  empty?: boolean;
  emptyText?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (error) {
    return (
      <div className="alert error" role="alert">
        {error.message}
        {error.requestId ? (
          <span className="mono"> (request {error.requestId.slice(0, 8)})</span>
        ) : null}{' '}
        {onRetry ? (
          <button className="small" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  if (loading && empty !== false) return <div className="state">Loading…</div>;
  if (empty) return <div className="state">{emptyText}</div>;
  return <>{children}</>;
}
