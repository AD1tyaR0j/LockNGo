/**
 * Database schema (Drizzle). Constraints that Drizzle cannot express — the booking
 * EXCLUDE constraint and the append-only audit trigger — live in the custom migration
 * drizzle/0001_integrity_constraints.sql.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ACCESS_PURPOSES,
  BOOKING_STATUSES,
  COMPARTMENT_OPERATIONAL_STATUSES,
  COMPARTMENT_SIZES,
  DEVICE_COMMAND_STATUSES,
  DEVICE_STATUSES,
  DOOR_STATES,
  OUTLET_STATUSES,
  PAYMENT_STATUSES,
  ROLES,
  type OperatingHours,
  type QuoteLine,
} from '@sl/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

export const roleName = pgEnum('role_name', ROLES);
export const compartmentSize = pgEnum('compartment_size', COMPARTMENT_SIZES);
export const compartmentOperationalStatus = pgEnum(
  'compartment_operational_status',
  COMPARTMENT_OPERATIONAL_STATUSES,
);
export const doorState = pgEnum('door_state', DOOR_STATES);
export const outletStatus = pgEnum('outlet_status', OUTLET_STATUSES);
export const deviceStatus = pgEnum('device_status', DEVICE_STATUSES);
export const bookingStatus = pgEnum('booking_status', BOOKING_STATUSES);
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES);
export const accessPurpose = pgEnum('access_purpose', ACCESS_PURPOSES);
export const deviceCommandStatus = pgEnum('device_command_status', DEVICE_COMMAND_STATUSES);
export const actorType = pgEnum('actor_type', ['USER', 'DEVICE', 'SYSTEM']);

// ---------------- Identity & access ----------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    status: text('status', { enum: ['ACTIVE', 'SUSPENDED'] })
      .notNull()
      .default('ACTIVE'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`)],
);

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: roleName('name').notNull().unique(),
});

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  description: text('description').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    assignedBy: uuid('assigned_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the opaque bearer token. The raw token is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

// ---------------- Outlet network ----------------

export const outlets = pgTable(
  'outlets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    postalCode: text('postal_code').notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    operatingHours: jsonb('operating_hours').$type<OperatingHours>().notNull(),
    status: outletStatus('status').notNull().default('DRAFT'),
    hostPartnerId: uuid('host_partner_id'),
    createdAt: createdAt(),
  },
  (t) => [index('outlets_status_city_idx').on(t.status, t.city)],
);

export const lockerBanks = pgTable(
  'locker_banks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    label: text('label').notNull(),
    model: text('model').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('locker_banks_outlet_label_uq').on(t.outletId, t.label)],
);

export const compartments = pgTable(
  'compartments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lockerBankId: uuid('locker_bank_id')
      .notNull()
      .references(() => lockerBanks.id),
    code: text('code').notNull(),
    size: compartmentSize('size').notNull(),
    maxWeightGrams: integer('max_weight_grams').notNull(),
    operationalStatus: compartmentOperationalStatus('operational_status')
      .notNull()
      .default('IN_SERVICE'),
    /** Last door state reported by the device. Physical truth comes from the device. */
    doorState: doorState('door_state').notNull().default('UNKNOWN'),
    doorStateAt: ts('door_state_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('compartments_bank_code_uq').on(t.lockerBankId, t.code),
    check('compartments_weight_positive', sql`${t.maxWeightGrams} > 0`),
  ],
);

// ---------------- Devices ----------------

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceIdentifier: text('device_identifier').notNull().unique(),
  lockerBankId: uuid('locker_bank_id')
    .notNull()
    .unique()
    .references(() => lockerBanks.id),
  hardwareModel: text('hardware_model').notNull(),
  firmwareVersion: text('firmware_version').notNull(),
  status: deviceStatus('status').notNull().default('PROVISIONED'),
  /** Simulated devices have no physical hardware. Surfaced in every API response. */
  isSimulated: boolean('is_simulated').notNull(),
  lastSeenAt: ts('last_seen_at'),
  /** Highest accepted event sequence number (replay protection). */
  lastSequence: bigint('last_sequence', { mode: 'number' }).notNull().default(-1),
  /** SHA-256 of the per-device token. See docs/security/device-credentials.md. */
  credentialHash: text('credential_hash').notNull(),
  credentialRotatedAt: ts('credential_rotated_at').notNull().defaultNow(),
  createdAt: createdAt(),
});

export const deviceEvents = pgTable(
  'device_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    /** Device-generated event id; unique per device to deduplicate retries. */
    eventId: uuid('event_id').notNull(),
    compartmentId: uuid('compartment_id').references(() => compartments.id),
    commandId: uuid('command_id'),
    eventType: text('event_type').notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurredAt: ts('occurred_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    verificationStatus: text('verification_status', {
      enum: ['ACCEPTED', 'OUT_OF_ORDER', 'CLOCK_SKEW'],
    }).notNull(),
  },
  (t) => [
    uniqueIndex('device_events_device_event_uq').on(t.deviceId, t.eventId),
    index('device_events_device_received_idx').on(t.deviceId, t.receivedAt),
  ],
);

export const deviceHealthSnapshots = pgTable(
  'device_health_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    connectivity: text('connectivity').notNull(),
    powerState: text('power_state').notNull(),
    firmwareVersion: text('firmware_version').notNull(),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
  },
  (t) => [index('device_health_device_idx').on(t.deviceId, t.recordedAt)],
);

// ---------------- Pricing, quotes, bookings ----------------

export const pricingRules = pgTable(
  'pricing_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version').notNull(),
    size: compartmentSize('size').notNull(),
    baseAmountMinor: integer('base_amount_minor').notNull(),
    perHourAmountMinor: integer('per_hour_amount_minor').notNull(),
    /** Tax in basis points (1800 = 18%). Configurable; confirm with a tax advisor. */
    taxBps: integer('tax_bps').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    /** Seeded demo rates are flagged so they are never mistaken for commercial prices. */
    isDemo: boolean('is_demo').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pricing_rules_size_version_uq').on(t.size, t.version),
    uniqueIndex('pricing_rules_one_active_per_size_uq')
      .on(t.size)
      .where(sql`${t.isActive}`),
    check(
      'pricing_rules_non_negative',
      sql`${t.baseAmountMinor} >= 0 AND ${t.perHourAmountMinor} >= 0 AND ${t.taxBps} >= 0`,
    ),
  ],
);

export const priceQuotes = pgTable('price_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => users.id),
  serviceType: text('service_type', { enum: ['STORAGE'] }).notNull(),
  outletId: uuid('outlet_id')
    .notNull()
    .references(() => outlets.id),
  size: compartmentSize('size').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull().default('INR'),
  breakdown: jsonb('breakdown').$type<QuoteLine[]>().notNull(),
  pricingRuleId: uuid('pricing_rule_id')
    .notNull()
    .references(() => pricingRules.id),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
});

export const storageBookings = pgTable(
  'storage_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id),
    compartmentId: uuid('compartment_id')
      .notNull()
      .references(() => compartments.id),
    startsAt: ts('starts_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    status: bookingStatus('status').notNull(),
    /** While PENDING_PAYMENT, the compartment is held only until this time. */
    paymentHoldExpiresAt: ts('payment_hold_expires_at'),
    priceQuoteId: uuid('price_quote_id')
      .notNull()
      .unique()
      .references(() => priceQuotes.id),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('INR'),
    idempotencyKey: text('idempotency_key').notNull(),
    depositedAt: ts('deposited_at'),
    retrievedAt: ts('retrieved_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('storage_bookings_customer_idem_uq').on(t.customerId, t.idempotencyKey),
    index('storage_bookings_customer_idx').on(t.customerId, t.createdAt),
    index('storage_bookings_compartment_idx').on(t.compartmentId, t.status),
    index('storage_bookings_status_idx').on(t.status),
    check('storage_bookings_range_valid', sql`${t.expiresAt} > ${t.startsAt}`),
  ],
);

export const bookingEvents = pgTable(
  'booking_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => storageBookings.id),
    eventType: text('event_type').notNull(),
    fromStatus: bookingStatus('from_status'),
    toStatus: bookingStatus('to_status'),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('booking_events_booking_idx').on(t.bookingId, t.id)],
);

export const accessCredentials = pgTable(
  'access_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => storageBookings.id),
    compartmentId: uuid('compartment_id')
      .notNull()
      .references(() => compartments.id),
    /** HMAC-SHA256 of the PIN keyed with ACCESS_PIN_PEPPER. The PIN itself is never stored. */
    credentialHash: text('credential_hash').notNull(),
    credentialType: text('credential_type', { enum: ['PIN'] }).notNull(),
    validFrom: ts('valid_from').notNull(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('access_credentials_one_live_per_booking_uq')
      .on(t.bookingId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => storageBookings.id),
  provider: text('provider').notNull(),
  providerOrderId: text('provider_order_id').notNull().unique(),
  providerPaymentId: text('provider_payment_id'),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull().default('INR'),
  status: paymentStatus('status').notNull(),
  failureReason: text('failure_reason'),
  createdAt: createdAt(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_webhook_events_uq').on(t.provider, t.providerEventId)],
);

export const deviceCommands = pgTable(
  'device_commands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    compartmentId: uuid('compartment_id')
      .notNull()
      .references(() => compartments.id),
    bookingId: uuid('booking_id').references(() => storageBookings.id),
    commandType: text('command_type', { enum: ['UNLOCK'] }).notNull(),
    purpose: accessPurpose('purpose').notNull(),
    requestedBy: uuid('requested_by').references(() => users.id),
    status: deviceCommandStatus('status').notNull().default('PENDING'),
    nonce: text('nonce').notNull().unique(),
    resultDetail: text('result_detail'),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    deliveredAt: ts('delivered_at'),
    acknowledgedAt: ts('acknowledged_at'),
    doorOpenedAt: ts('door_opened_at'),
    completedAt: ts('completed_at'),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    // At most one in-flight command per compartment.
    uniqueIndex('device_commands_one_inflight_per_compartment_uq')
      .on(t.compartmentId)
      .where(sql`${t.status} IN ('PENDING','DELIVERED','ACKNOWLEDGED')`),
    index('device_commands_device_status_idx').on(t.deviceId, t.status),
  ],
);

// ---------------- Audit ----------------

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    requestId: text('request_id'),
    /** Safe metadata only: never secrets, OTPs, PINs or tokens. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_resource_idx').on(t.resourceType, t.resourceId),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
);
