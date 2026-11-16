import type {
  AccessPurpose,
  AuthResponse,
  BookingDetail,
  CompartmentSize,
  CreateBookingResponse,
  CredentialIssued,
  Me,
  OutletSummary,
  Paginated,
  SizeAvailability,
  StorageQuote,
} from '@sl/shared';
import { tokenStore } from './token-store';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthenticated: (() => void) | undefined;
export const setUnauthenticatedHandler = (fn: () => void) => {
  onUnauthenticated = fn;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const token = await tokenStore.get();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      'OFFLINE',
      'Cannot reach the server. Check your connection and try again.',
    );
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthenticated?.();
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'ERROR',
      data?.error?.message ?? 'Something went wrong',
    );
  }
  return data as T;
}

/** Random idempotency key per user action, so retries of the same tap never double-book. */
export const newIdempotencyKey = () =>
  `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export const api = {
  login: (email: string, password: string) =>
    request<AuthResponse>('POST', '/auth/login', { email, password }),
  register: (name: string, email: string, password: string) =>
    request<AuthResponse>('POST', '/auth/register', { name, email, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  me: () => request<Me>('GET', '/me'),
  outlets: () => request<{ items: OutletSummary[] }>('GET', '/outlets'),
  outlet: (id: string) => request<OutletSummary>('GET', `/outlets/${id}`),
  availability: (id: string, durationHours: number) =>
    request<{ startsAt: string; endsAt: string; sizes: SizeAvailability[] }>(
      'GET',
      `/outlets/${id}/availability?durationHours=${durationHours}`,
    ),
  quote: (outletId: string, size: CompartmentSize, durationHours: number) =>
    request<StorageQuote>('POST', '/storage/quotes', { outletId, size, durationHours }),
  book: (quoteId: string, idempotencyKey: string) =>
    request<CreateBookingResponse>(
      'POST',
      '/storage/bookings',
      { quoteId },
      { 'idempotency-key': idempotencyKey },
    ),
  bookings: () => request<Paginated<BookingDetail>>('GET', '/storage/bookings?limit=50'),
  booking: (id: string) => request<BookingDetail>('GET', `/storage/bookings/${id}`),
  cancel: (id: string) => request<BookingDetail>('POST', `/storage/bookings/${id}/cancel`),
  issuePin: (id: string) => request<CredentialIssued>('POST', `/storage/bookings/${id}/credential`),
  requestAccess: (id: string, purpose: AccessPurpose) =>
    request<{ commandId: string; status: string; expiresAt: string }>(
      'POST',
      `/storage/bookings/${id}/access`,
      { purpose },
    ),
  /** MOCK checkout (development only): asks the mock gateway to send a signed webhook. */
  mockPay: (paymentId: string, outcome: 'success' | 'failure') =>
    request<{ mock: true; outcome: string }>('POST', `/payments/mock/${paymentId}/complete`, {
      outcome,
    }),
};
