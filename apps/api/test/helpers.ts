import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import type { Role } from '@sl/shared';
import { createApp } from '../src/app.js';
import { getDb } from '../src/db/client.js';
import { roles, userRoles, users } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/crypto.js';

export const app = createApp();
export const api = () => request(app);
const PASSWORD = 'correct-horse-battery';

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}${randomUUID().slice(0, 4)}`;

export async function registerCustomer() {
  const email = `cust-${uniq()}@test.local`;
  const res = await api()
    .post('/api/v1/auth/register')
    .send({ name: 'Test Customer', email, password: PASSWORD });
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, userId: res.body.user.id as string, email };
}

/** Staff users cannot self-register; tests create them directly, as an admin tool would. */
export async function createStaff(role: Role) {
  const db = getDb();
  const email = `${role.toLowerCase()}-${uniq()}@test.local`;
  const [u] = await db
    .insert(users)
    .values({ name: role, email, passwordHash: await hashPassword(PASSWORD) })
    .returning();
  const [r] = await db.select().from(roles).where(eq(roles.name, role));
  await db.insert(userRoles).values({ userId: u!.id, roleId: r!.id });
  const res = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
  return { token: res.body.token as string, userId: u!.id };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken: string | undefined;
export async function admin() {
  adminToken ??= (await createStaff('ADMIN')).token;
  return adminToken;
}

export interface TestOutlet {
  outletId: string;
  lockerBankId: string;
  deviceId: string;
  deviceToken: string;
  compartmentIds: Record<string, string>;
}

/** Creates an ACTIVE 24x7 outlet with one bank, given compartments and one simulated device. */
export async function createOutlet(
  layout: { code: string; size: 'S' | 'M' | 'L' | 'XL' }[] = [{ code: 'S1', size: 'S' }],
): Promise<TestOutlet> {
  const t = await admin();
  const o = await api()
    .post('/api/v1/admin/outlets')
    .set(auth(t))
    .send({
      name: `Test Outlet ${uniq()}`,
      address: '1 Test Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      latitude: 12.97,
      longitude: 77.59,
      operatingHours: { open: '00:00', close: '00:00', is24x7: true },
      status: 'ACTIVE',
    });
  if (o.status !== 201) throw new Error(`outlet: ${JSON.stringify(o.body)}`);
  const bank = await api()
    .post(`/api/v1/admin/outlets/${o.body.id}/locker-banks`)
    .set(auth(t))
    .send({
      label: 'A',
      model: 'TEST',
      compartments: layout.map((c) => ({ ...c, maxWeightGrams: 5000 })),
    });
  if (bank.status !== 201) throw new Error(`bank: ${JSON.stringify(bank.body)}`);
  const dev = await api()
    .post('/api/v1/admin/devices')
    .set(auth(t))
    .send({
      lockerBankId: bank.body.id,
      deviceIdentifier: `SIM-${uniq()}`,
      hardwareModel: 'SIMULATOR',
      firmwareVersion: 'sim-test',
      isSimulated: true,
    });
  if (dev.status !== 201) throw new Error(`device: ${JSON.stringify(dev.body)}`);
  const detail = await api().get(`/api/v1/admin/outlets/${o.body.id}`).set(auth(t));
  const compartmentIds: Record<string, string> = {};
  for (const c of detail.body.lockerBanks[0].compartments) compartmentIds[c.code] = c.id;
  return {
    outletId: o.body.id,
    lockerBankId: bank.body.id,
    deviceId: dev.body.device.id,
    deviceToken: dev.body.deviceToken,
    compartmentIds,
  };
}

export async function heartbeat(deviceToken: string) {
  return api().post('/api/v1/devices/heartbeat').set(auth(deviceToken)).send({
    firmwareVersion: 'sim-test',
    powerState: 'MAINS',
    connectivity: 'WIFI',
    sentAt: new Date().toISOString(),
  });
}

export async function quote(
  token: string,
  outletId: string,
  opts: { size?: 'S' | 'M' | 'L' | 'XL'; durationHours?: number; startsAt?: string } = {},
) {
  return api()
    .post('/api/v1/storage/quotes')
    .set(auth(token))
    .send({
      outletId,
      size: opts.size ?? 'S',
      durationHours: opts.durationHours ?? 2,
      startsAt: opts.startsAt,
    });
}

export async function book(token: string, quoteId: string, idempotencyKey = `idem-${uniq()}`) {
  return api()
    .post('/api/v1/storage/bookings')
    .set(auth(token))
    .set('Idempotency-Key', idempotencyKey)
    .send({ quoteId });
}

export async function pay(
  token: string,
  paymentId: string,
  outcome: 'success' | 'failure' = 'success',
) {
  return api()
    .post(`/api/v1/payments/mock/${paymentId}/complete`)
    .set(auth(token))
    .send({ outcome });
}

/** Quote → book → mock-pay. Returns the booking id. */
export async function paidBooking(
  token: string,
  outletId: string,
  opts: Parameters<typeof quote>[2] = {},
) {
  const q = await quote(token, outletId, opts);
  if (q.status !== 201) throw new Error(`quote: ${JSON.stringify(q.body)}`);
  const b = await book(token, q.body.id);
  if (b.status !== 201) throw new Error(`book: ${JSON.stringify(b.body)}`);
  const p = await pay(token, b.body.payment.id);
  if (p.body.outcome !== 'BOOKING_CONFIRMED') throw new Error(`pay: ${JSON.stringify(p.body)}`);
  return b.body.booking.id as string;
}

let seq = 0;
export function deviceEvent(
  deviceToken: string,
  body: {
    type: string;
    compartmentCode?: string;
    commandId?: string;
    sequence?: number;
    eventId?: string;
  },
) {
  return api()
    .post('/api/v1/devices/events')
    .set(auth(deviceToken))
    .send({
      eventId: body.eventId ?? randomUUID(),
      type: body.type,
      compartmentCode: body.compartmentCode,
      commandId: body.commandId,
      occurredAt: new Date().toISOString(),
      sequence: body.sequence ?? ++seq + 1000,
    });
}

/** Simulates the device side of an unlock: poll, ack, door open, door close. */
export async function deviceCompletesUnlock(deviceToken: string) {
  const poll = await api().get('/api/v1/devices/commands').set(auth(deviceToken));
  const cmd = poll.body.commands[0];
  if (!cmd) throw new Error('no command delivered');
  const ack = await api()
    .post(`/api/v1/devices/commands/${cmd.commandId}/ack`)
    .set(auth(deviceToken))
    .send({ result: 'OK', nonce: cmd.nonce });
  if (ack.status !== 200) throw new Error(`ack: ${JSON.stringify(ack.body)}`);
  await deviceEvent(deviceToken, {
    type: 'DOOR_OPENED',
    compartmentCode: cmd.compartmentCode,
    commandId: cmd.commandId,
  });
  await deviceEvent(deviceToken, {
    type: 'DOOR_CLOSED',
    compartmentCode: cmd.compartmentCode,
    commandId: cmd.commandId,
  });
  return cmd;
}
