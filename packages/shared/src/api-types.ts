import type {
  AccessPurpose,
  BookingStatus,
  CompartmentDisplayStatus,
  CompartmentOperationalStatus,
  CompartmentSize,
  DeviceCommandStatus,
  DeviceStatus,
  DoorState,
  OutletStatus,
  PaymentStatus,
  Role,
} from './enums';
import type { OperatingHours } from './schemas';

export interface ApiError {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

export interface Me {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  permissions: string[];
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: Me;
}

export interface Money {
  amountMinor: number;
  currency: 'INR';
}

export interface OutletSummary {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  operatingHours: OperatingHours;
  /** True when any device at the outlet is simulated (no physical hardware). */
  hasSimulatedDevices: boolean;
}

export interface AdminOutlet extends OutletSummary {
  status: OutletStatus;
  createdAt: string;
}

export interface SizeAvailability {
  size: CompartmentSize;
  available: number;
  total: number;
}

export interface QuoteLine {
  label: string;
  amountMinor: number;
}

export interface StorageQuote {
  id: string;
  outletId: string;
  size: CompartmentSize;
  startsAt: string;
  expiresAt: string;
  durationHours: number;
  total: Money;
  breakdown: QuoteLine[];
  pricingRuleVersion: number;
  quoteExpiresAt: string;
}

export interface PaymentSummary {
  id: string;
  provider: string;
  /** True for the development mock provider — no money moved. */
  isMock: boolean;
  status: PaymentStatus;
  providerOrderId: string;
  amount: Money;
}

export interface BookingEvent {
  id: string;
  type: string;
  actorType: 'USER' | 'DEVICE' | 'SYSTEM';
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface BookingDetail {
  id: string;
  reference: string;
  status: BookingStatus;
  outlet: { id: string; name: string; address: string };
  compartment: { code: string; size: CompartmentSize; lockerBankLabel: string; isSimulated: boolean };
  startsAt: string;
  expiresAt: string;
  paymentHoldExpiresAt: string | null;
  total: Money;
  breakdown: QuoteLine[];
  payment: PaymentSummary | null;
  /** Expected next physical action, when any. */
  nextAccessPurpose: AccessPurpose | null;
  pendingCommand: { id: string; purpose: AccessPurpose; status: DeviceCommandStatus; expiresAt: string } | null;
  events: BookingEvent[];
  createdAt: string;
}

export interface CreateBookingResponse {
  booking: BookingDetail;
  payment: PaymentSummary;
}

export interface CredentialIssued {
  /** Shown once. Only a hash is stored server-side. */
  pin: string;
  validFrom: string;
  expiresAt: string;
}

export interface AdminCompartment {
  id: string;
  code: string;
  size: CompartmentSize;
  maxWeightGrams: number;
  operationalStatus: CompartmentOperationalStatus;
  displayStatus: CompartmentDisplayStatus;
  doorState: DoorState;
}

export interface AdminDevice {
  id: string;
  deviceIdentifier: string;
  hardwareModel: string;
  firmwareVersion: string;
  status: DeviceStatus;
  isSimulated: boolean;
  lastSeenAt: string | null;
}

export interface AdminLockerBank {
  id: string;
  label: string;
  model: string;
  device: AdminDevice | null;
  compartments: AdminCompartment[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
