/** Shared domain enums. The API database enums are generated from these lists. */

export const ROLES = [
  'CUSTOMER',
  'COURIER',
  'HOST_PARTNER',
  'OUTLET_OPERATOR',
  'MAINTENANCE_TECHNICIAN',
  'SUPPORT_AGENT',
  'ADMIN',
  'SUPER_ADMIN',
] as const;
export type Role = (typeof ROLES)[number];

export const COMPARTMENT_SIZES = ['S', 'M', 'L', 'XL'] as const;
export type CompartmentSize = (typeof COMPARTMENT_SIZES)[number];

/** Operational (maintenance) status stored on the compartment row. */
export const COMPARTMENT_OPERATIONAL_STATUSES = [
  'IN_SERVICE',
  'NEEDS_INSPECTION',
  'OUT_OF_SERVICE',
] as const;
export type CompartmentOperationalStatus = (typeof COMPARTMENT_OPERATIONAL_STATUSES)[number];

/**
 * Display status derived from operational status + bookings covering "now".
 * Never stored: see docs/adr/0004-compartment-vs-booking-state.md.
 */
export const COMPARTMENT_DISPLAY_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'OCCUPIED',
  'NEEDS_INSPECTION',
  'OUT_OF_SERVICE',
] as const;
export type CompartmentDisplayStatus = (typeof COMPARTMENT_DISPLAY_STATUSES)[number];

export const DOOR_STATES = ['OPEN', 'CLOSED', 'UNKNOWN'] as const;
export type DoorState = (typeof DOOR_STATES)[number];

export const OUTLET_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED'] as const;
export type OutletStatus = (typeof OUTLET_STATUSES)[number];

export const DEVICE_STATUSES = [
  'PROVISIONED',
  'ONLINE',
  'OFFLINE',
  'FAULT',
  'DECOMMISSIONED',
] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'ACCESS_READY',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'DISPUTED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Booking statuses that hold a compartment for their time range (enforced by an EXCLUDE constraint). */
export const BLOCKING_BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'ACCESS_READY',
  'ACTIVE',
  'DISPUTED',
] as const satisfies readonly BookingStatus[];

export const PAYMENT_STATUSES = [
  'CREATED',
  'CAPTURED',
  'FAILED',
  'REFUND_REQUIRED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ACCESS_PURPOSES = ['DEPOSIT', 'RETRIEVE'] as const;
export type AccessPurpose = (typeof ACCESS_PURPOSES)[number];

export const DEVICE_COMMAND_STATUSES = [
  'PENDING',
  'DELIVERED',
  'ACKNOWLEDGED',
  'FAILED',
  'EXPIRED',
  'COMPLETED',
] as const;
export type DeviceCommandStatus = (typeof DEVICE_COMMAND_STATUSES)[number];

export const DEVICE_EVENT_TYPES = [
  'DOOR_OPENED',
  'DOOR_CLOSED',
  'TAMPER_DETECTED',
  'SENSOR_FAULT',
  'POWER_LOST',
  'POWER_RESTORED',
] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];
