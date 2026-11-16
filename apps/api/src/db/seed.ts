/**
 * DEVELOPMENT SEED DATA. Creates demo users, demo outlets, locker banks, SIMULATED devices and
 * demo pricing. Refuses to run in production. Re-running is safe: existing rows are kept and
 * simulated device tokens are rotated and re-written to .sim-devices.json (git-ignored).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import type { CompartmentSize, Role } from '@sl/shared';
import { config } from '../config.js';
import { closeDb, getDb } from './client.js';
import {
  compartments,
  devices,
  lockerBanks,
  outlets,
  pricingRules,
  roles,
  userRoles,
  users,
} from './schema.js';
import { hashPassword, newOpaqueToken, sha256 } from '../lib/crypto.js';
import { runMigrations } from './migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SIM_FILE = path.resolve(here, '../../../../.sim-devices.json');

const DEMO_USERS: { name: string; email: string; roles: Role[] }[] = [
  { name: 'Demo Customer', email: 'customer@demo.local', roles: ['CUSTOMER'] },
  { name: 'Second Demo Customer', email: 'customer2@demo.local', roles: ['CUSTOMER'] },
  { name: 'Demo Admin', email: 'admin@demo.local', roles: ['ADMIN'] },
  { name: 'Demo Support Agent', email: 'support@demo.local', roles: ['SUPPORT_AGENT'] },
];

/** DEMO rates (paise). Not commercial prices — replace via admin pricing before any pilot. */
const DEMO_PRICING: Record<CompartmentSize, { base: number; perHour: number }> = {
  S: { base: 2000, perHour: 3000 },
  M: { base: 2000, perHour: 4500 },
  L: { base: 3000, perHour: 6000 },
  XL: { base: 4000, perHour: 8000 },
};

const DEMO_OUTLETS = [
  {
    name: '[DEMO] Indiranagar Metro Locker Point',
    address: '100 Feet Rd, near Indiranagar Metro (demo address)',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560038',
    latitude: 12.9784,
    longitude: 77.6408,
    operatingHours: { open: '00:00', close: '00:00', is24x7: true },
    bank: 'A',
    device: 'SIM-BLR-IND-A',
  },
  {
    name: '[DEMO] Koramangala Forum Lockers',
    address: 'Hosur Rd, Koramangala (demo address)',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560095',
    latitude: 12.9346,
    longitude: 77.6113,
    operatingHours: { open: '08:00', close: '23:00', is24x7: false },
    bank: 'A',
    device: 'SIM-BLR-KOR-A',
  },
  {
    name: '[DEMO] CSMT Station Lockers',
    address: 'Chhatrapati Shivaji Maharaj Terminus (demo address)',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400001',
    latitude: 18.9398,
    longitude: 72.8355,
    operatingHours: { open: '00:00', close: '00:00', is24x7: true },
    bank: 'A',
    device: 'SIM-BOM-CSMT-A',
  },
] as const;

const LAYOUT: { code: string; size: CompartmentSize; maxWeightGrams: number }[] = [
  ...['S1', 'S2', 'S3', 'S4'].map((code) => ({ code, size: 'S' as const, maxWeightGrams: 5000 })),
  ...['M1', 'M2', 'M3'].map((code) => ({ code, size: 'M' as const, maxWeightGrams: 15000 })),
  ...['L1', 'L2'].map((code) => ({ code, size: 'L' as const, maxWeightGrams: 25000 })),
  { code: 'XL1', size: 'XL', maxWeightGrams: 35000 },
];

export async function seed() {
  const cfg = config();
  if (cfg.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  // `||` (not `??`): an empty SEED_DEMO_PASSWORD= line in .env means "use the default".
  const password = process.env.SEED_DEMO_PASSWORD || 'LockerDemo#2026';
  if (password.length < 10) throw new Error('SEED_DEMO_PASSWORD must be at least 10 characters');
  await runMigrations();
  const db = getDb();

  for (const u of DEMO_USERS) {
    const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${u.email}`);
    const passwordHash = await hashPassword(password);
    if (existing) {
      // Demo accounts only: keep their password in sync with the current seed password.
      await db.update(users).set({ passwordHash }).where(eq(users.id, existing.id));
    }
    const userId =
      existing?.id ??
      (await db.insert(users).values({ name: u.name, email: u.email, passwordHash }).returning())[0]!
        .id;
    for (const r of u.roles) {
      const [role] = await db.select().from(roles).where(eq(roles.name, r));
      await db.insert(userRoles).values({ userId, roleId: role!.id }).onConflictDoNothing();
    }
  }

  for (const [size, p] of Object.entries(DEMO_PRICING) as [CompartmentSize, { base: number; perHour: number }][]) {
    const [active] = await db
      .select()
      .from(pricingRules)
      .where(and(eq(pricingRules.size, size), eq(pricingRules.isActive, true)));
    if (!active) {
      await db.insert(pricingRules).values({
        version: 1,
        size,
        baseAmountMinor: p.base,
        perHourAmountMinor: p.perHour,
        taxBps: 1800,
        isDemo: true,
      });
    }
  }

  const simDevices: { deviceIdentifier: string; outlet: string; token: string; compartments: string[] }[] = [];
  for (const o of DEMO_OUTLETS) {
    let [outlet] = await db.select().from(outlets).where(eq(outlets.name, o.name));
    if (!outlet) {
      [outlet] = await db
        .insert(outlets)
        .values({
          name: o.name,
          address: o.address,
          city: o.city,
          state: o.state,
          postalCode: o.postalCode,
          latitude: o.latitude,
          longitude: o.longitude,
          operatingHours: o.operatingHours,
          status: 'ACTIVE',
        })
        .returning();
    }
    let [bank] = await db
      .select()
      .from(lockerBanks)
      .where(and(eq(lockerBanks.outletId, outlet!.id), eq(lockerBanks.label, o.bank)));
    if (!bank) {
      [bank] = await db
        .insert(lockerBanks)
        .values({ outletId: outlet!.id, label: o.bank, model: 'SIMULATED-10' })
        .returning();
      await db.insert(compartments).values(LAYOUT.map((c) => ({ ...c, lockerBankId: bank!.id })));
    }
    const token = newOpaqueToken(32);
    const [dev] = await db.select().from(devices).where(eq(devices.deviceIdentifier, o.device));
    if (dev) {
      await db
        .update(devices)
        .set({ credentialHash: sha256(token), credentialRotatedAt: new Date() })
        .where(eq(devices.id, dev.id));
    } else {
      await db.insert(devices).values({
        deviceIdentifier: o.device,
        lockerBankId: bank!.id,
        hardwareModel: 'SIMULATOR',
        firmwareVersion: 'sim-0.1.0',
        isSimulated: true,
        credentialHash: sha256(token),
      });
    }
    simDevices.push({
      deviceIdentifier: o.device,
      outlet: o.name,
      token,
      compartments: LAYOUT.map((c) => c.code),
    });
  }

  writeFileSync(
    SIM_FILE,
    JSON.stringify(
      {
        warning: 'DEV ONLY. Simulated device tokens generated by the seed script. Do not commit.',
        apiUrl: `http://localhost:${cfg.PORT}`,
        devices: simDevices,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Seeded demo data. Demo users (password from SEED_DEMO_PASSWORD or the documented dev default):`);
  for (const u of DEMO_USERS) console.log(`  ${u.email.padEnd(24)} ${u.roles.join(', ')}`);
  console.log(`Simulated device tokens written to ${SIM_FILE}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed()
    .then(() => closeDb())
    .catch(async (err) => {
      console.error(err);
      await closeDb();
      process.exit(1);
    });
}
