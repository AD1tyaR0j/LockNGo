'use client';

import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

/** Browser → this app's BFF. Never talks to the backend directly; never sees the token. */
export async function adminFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/proxy/${path.replace(/^\//, '')}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-admin-web': '1' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    const detail = Array.isArray(e?.details)
      ? ': ' + e.details.map((d: { path: string; message: string }) => `${d.path} ${d.message}`).join('; ')
      : '';
    throw new ApiError(res.status, e?.code ?? 'ERROR', (e?.message ?? 'Request failed') + detail, e?.requestId);
  }
  return data as T;
}

export function useAdminData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await adminFetch<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Network error — check your connection'));
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

export const formatInr = (minor: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);

export const formatTime = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(iso))
    : '—';
