import { z } from 'zod';
import { ACCESS_PURPOSES, COMPARTMENT_SIZES, DEVICE_EVENT_TYPES, OUTLET_STATUSES } from './enums';

/** Hard platform limits for MVP. Commercial values (prices) live in admin-configured pricing rules. */
export const BOOKING_LIMITS = {
  minHours: 1,
  maxHours: 72,
  maxAdvanceDays: 7,
} as const;

const email = z.string().trim().toLowerCase().email().max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  password: z.string().min(10).max(200),
  phone: z
    .string()
    .trim()
    .regex(/^\+91[6-9]\d{9}$/, 'Expected an Indian mobile number in +91XXXXXXXXXX format')
    .optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export type LoginInput = z.infer<typeof loginSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const operatingHoursSchema = z
  .object({
    /** Simplified MVP model: same hours every day, in the outlet's local time zone. */
    open: hhmm,
    close: hhmm,
    is24x7: z.boolean().default(false),
  })
  .strict();
export type OperatingHours = z.infer<typeof operatingHoursSchema>;

export const createOutletSchema = z.object({
  name: z.string().trim().min(1).max(160),
  address: z.string().trim().min(1).max(500),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().regex(/^\d{6}$/, 'Expected a 6-digit PIN code'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  operatingHours: operatingHoursSchema,
  status: z.enum(OUTLET_STATUSES).default('DRAFT'),
});
export type CreateOutletInput = z.infer<typeof createOutletSchema>;
export const updateOutletSchema = createOutletSchema.partial();
export type UpdateOutletInput = z.infer<typeof updateOutletSchema>;

export const createLockerBankSchema = z.object({
  label: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  compartments: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .regex(/^[A-Z0-9-]{1,12}$/),
        size: z.enum(COMPARTMENT_SIZES),
        maxWeightGrams: z.number().int().positive().max(100_000),
      }),
    )
    .max(200)
    .default([]),
});
export type CreateLockerBankInput = z.infer<typeof createLockerBankSchema>;

export const registerDeviceSchema = z.object({
  lockerBankId: z.string().uuid(),
  deviceIdentifier: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{3,64}$/),
  hardwareModel: z.string().trim().min(1).max(60),
  firmwareVersion: z.string().trim().min(1).max(40),
  isSimulated: z.boolean(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const compartmentStatusChangeSchema = z.object({
  action: z.enum(['DISABLE', 'MARK_NEEDS_INSPECTION', 'RETURN_TO_SERVICE']),
  reason: z.string().trim().min(3).max(500),
});
export type CompartmentStatusChangeInput = z.infer<typeof compartmentStatusChangeSchema>;

export const storageQuoteRequestSchema = z.object({
  outletId: z.string().uuid(),
  size: z.enum(COMPARTMENT_SIZES),
  /** Omit to start now. */
  startsAt: z.string().datetime({ offset: true }).optional(),
  durationHours: z.number().int().min(BOOKING_LIMITS.minHours).max(BOOKING_LIMITS.maxHours),
});
export type StorageQuoteRequest = z.infer<typeof storageQuoteRequestSchema>;

export const createBookingSchema = z.object({ quoteId: z.string().uuid() });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const accessRequestSchema = z.object({ purpose: z.enum(ACCESS_PURPOSES) });
export type AccessRequestInput = z.infer<typeof accessRequestSchema>;

export const mockPaymentOutcomeSchema = z.object({ outcome: z.enum(['success', 'failure']) });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

// ---------- Device-facing (internal) schemas ----------

export const deviceHeartbeatSchema = z.object({
  firmwareVersion: z.string().max(40),
  powerState: z.enum(['MAINS', 'BATTERY', 'UNKNOWN']),
  connectivity: z.enum(['WIFI', 'ETHERNET', 'CELLULAR', 'UNKNOWN']),
  sentAt: z.string().datetime({ offset: true }),
});
export type DeviceHeartbeat = z.infer<typeof deviceHeartbeatSchema>;

export const deviceEventSchema = z.object({
  eventId: z.string().uuid(),
  compartmentCode: z.string().max(12).optional(),
  type: z.enum(DEVICE_EVENT_TYPES),
  occurredAt: z.string().datetime({ offset: true }),
  sequence: z.number().int().nonnegative(),
  /** Set when the event results from a backend command (e.g. door opened after UNLOCK). */
  commandId: z.string().uuid().optional(),
});
export type DeviceEventInput = z.infer<typeof deviceEventSchema>;

export const deviceCommandAckSchema = z.object({
  result: z.enum(['OK', 'FAILED']),
  nonce: z.string().min(16).max(128),
  detail: z.string().max(200).optional(),
});
export type DeviceCommandAck = z.infer<typeof deviceCommandAckSchema>;
