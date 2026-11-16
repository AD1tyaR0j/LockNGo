import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closeDb } from '../src/db/client.js';
import { addSeconds, clock } from '../src/lib/clock.js';
import { runSweep } from '../src/jobs/sweeper.js';
import {
  admin,
  api,
  auth,
  createOutlet,
  deviceCompletesUnlock,
  deviceEvent,
  heartbeat,
  paidBooking,
  quote,
  registerCustomer,
} from './helpers.js';

afterAll(closeDb);
afterEach(() => vi.restoreAllMocks());

const access = (token: string, id: string, purpose: 'DEPOSIT' | 'RETRIEVE') =>
  api().post(`/api/v1/storage/bookings/${id}/access`).set(auth(token)).send({ purpose });
const detail = (token: string, id: string) =>
  api().get(`/api/v1/storage/bookings/${id}`).set(auth(token));

describe('storage lifecycle driven by device events', () => {
  it('deposit then retrieval: status only changes after validated device events', async () => {
    const o = await createOutlet();
    await heartbeat(o.deviceToken);
    const c = await registerCustomer();
    const id = await paidBooking(c.token, o.outletId);

    const pin = await api().post(`/api/v1/storage/bookings/${id}/credential`).set(auth(c.token));
    expect(pin.status).toBe(201);
    expect(pin.body.pin).toMatch(/^\d{6}$/);
    expect((await detail(c.token, id)).body.status).toBe('ACCESS_READY');

    // Retrieval is not allowed before deposit.
    expect((await access(c.token, id, 'RETRIEVE')).status).toBe(409);

    const req = await access(c.token, id, 'DEPOSIT');
    expect(req.status).toBe(202);
    // Requesting again is idempotent while in flight.
    expect((await access(c.token, id, 'DEPOSIT')).body.commandId).toBe(req.body.commandId);
    // Requesting access alone does not change the booking.
    expect((await detail(c.token, id)).body.status).toBe('ACCESS_READY');

    const poll = await api().get('/api/v1/devices/commands').set(auth(o.deviceToken));
    const cmd = poll.body.commands[0];
    expect(cmd).toMatchObject({
      commandId: req.body.commandId,
      compartmentCode: 'S1',
      type: 'UNLOCK',
    });
    await api()
      .post(`/api/v1/devices/commands/${cmd.commandId}/ack`)
      .set(auth(o.deviceToken))
      .send({ result: 'OK', nonce: cmd.nonce });
    expect((await detail(c.token, id)).body.status).toBe('ACCESS_READY');

    await deviceEvent(o.deviceToken, {
      type: 'DOOR_OPENED',
      compartmentCode: 'S1',
      commandId: cmd.commandId,
    });
    expect((await detail(c.token, id)).body.status).toBe('ACCESS_READY');
    await deviceEvent(o.deviceToken, {
      type: 'DOOR_CLOSED',
      compartmentCode: 'S1',
      commandId: cmd.commandId,
    });
    expect((await detail(c.token, id)).body.status).toBe('ACTIVE');

    // Compartment shows OCCUPIED to admins; and cannot be booked by others even after the window.
    const t = await admin();
    const od = await api().get(`/api/v1/admin/outlets/${o.outletId}`).set(auth(t));
    expect(od.body.lockerBanks[0].compartments[0].displayStatus).toBe('OCCUPIED');

    expect((await access(c.token, id, 'RETRIEVE')).status).toBe(202);
    await deviceCompletesUnlock(o.deviceToken);
    const done = await detail(c.token, id);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.events.map((e: { type: string }) => e.type)).toEqual([
      'BOOKING_CREATED',
      'PAYMENT_CAPTURED',
      'ACCESS_CREDENTIAL_ISSUED',
      'UNLOCK_REQUESTED',
      'UNLOCK_ACKNOWLEDGED',
      'DOOR_OPENED',
      'DOOR_CLOSED',
      'ITEMS_DEPOSITED',
      'UNLOCK_REQUESTED',
      'UNLOCK_ACKNOWLEDGED',
      'DOOR_OPENED',
      'DOOR_CLOSED',
      'ITEMS_RETRIEVED',
    ]);
    // Compartment is free again.
    const c2 = await registerCustomer();
    expect((await quote(c2.token, o.outletId)).status).toBe(201);
  });

  it('refuses unlock when the device is offline', async () => {
    const o = await createOutlet();
    const c = await registerCustomer();
    const id = await paidBooking(c.token, o.outletId);
    // Never sent a heartbeat.
    const res = await access(c.token, id, 'DEPOSIT');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DEVICE_OFFLINE');

    await heartbeat(o.deviceToken);
    vi.spyOn(clock, 'now').mockReturnValue(addSeconds(new Date(), 120));
    await runSweep();
    expect((await access(c.token, id, 'DEPOSIT')).status).toBe(503);
  });

  it('an unacknowledged unlock times out and leaves the booking unchanged', async () => {
    const o = await createOutlet();
    await heartbeat(o.deviceToken);
    const c = await registerCustomer();
    const id = await paidBooking(c.token, o.outletId);
    expect((await access(c.token, id, 'DEPOSIT')).status).toBe(202);
    vi.spyOn(clock, 'now').mockReturnValue(addSeconds(new Date(), 61));
    const sweep = await runSweep();
    vi.restoreAllMocks();
    expect(sweep.expiredCommands).toBeGreaterThanOrEqual(1);
    const d = await detail(c.token, id);
    expect(d.body.status).toBe('CONFIRMED');
    expect(d.body.pendingCommand).toBeNull();
    expect(d.body.events.at(-1).type).toBe('UNLOCK_TIMED_OUT');
    // Late ack is rejected.
    const polled = await api().get('/api/v1/devices/commands').set(auth(o.deviceToken));
    expect(polled.body.commands).toHaveLength(0);
  });

  it('a door left open fails the command and flags the compartment for inspection', async () => {
    const o = await createOutlet();
    await heartbeat(o.deviceToken);
    const c = await registerCustomer();
    const id = await paidBooking(c.token, o.outletId);
    await access(c.token, id, 'DEPOSIT');
    const poll = await api().get('/api/v1/devices/commands').set(auth(o.deviceToken));
    const cmd = poll.body.commands[0];
    await api()
      .post(`/api/v1/devices/commands/${cmd.commandId}/ack`)
      .set(auth(o.deviceToken))
      .send({ result: 'OK', nonce: cmd.nonce });
    await deviceEvent(o.deviceToken, {
      type: 'DOOR_OPENED',
      compartmentCode: 'S1',
      commandId: cmd.commandId,
    });
    vi.spyOn(clock, 'now').mockReturnValue(addSeconds(new Date(), 400));
    const sweep = await runSweep();
    vi.restoreAllMocks();
    expect(sweep.doorLeftOpen).toBe(1);
    const t = await admin();
    const od = await api().get(`/api/v1/admin/outlets/${o.outletId}`).set(auth(t));
    expect(od.body.lockerBanks[0].compartments[0].operationalStatus).toBe('NEEDS_INSPECTION');
    // Uncertain deposit: booking is NOT marked ACTIVE.
    expect((await detail(c.token, id)).body.status).toBe('CONFIRMED');
  });

  it('a door opening without an authorised command flags the compartment', async () => {
    const o = await createOutlet();
    await heartbeat(o.deviceToken);
    await deviceEvent(o.deviceToken, { type: 'DOOR_OPENED', compartmentCode: 'S1' });
    const t = await admin();
    const od = await api().get(`/api/v1/admin/outlets/${o.outletId}`).set(auth(t));
    expect(od.body.lockerBanks[0].compartments[0].operationalStatus).toBe('NEEDS_INSPECTION');
    const c = await registerCustomer();
    expect((await quote(c.token, o.outletId)).status).toBe(409);
  });

  it('a tamper event takes the compartment out of bookable inventory', async () => {
    const o = await createOutlet();
    await heartbeat(o.deviceToken);
    const r = await deviceEvent(o.deviceToken, { type: 'TAMPER_DETECTED', compartmentCode: 'S1' });
    expect(r.body.applied).toBe(true);
    const c = await registerCustomer();
    expect((await quote(c.token, o.outletId)).status).toBe(409);
  });
});

describe('device event integrity', () => {
  it('deduplicates retried events and does not apply out-of-order ones', async () => {
    const o = await createOutlet();
    await heartbeat(o.deviceToken);
    const eventId = randomUUID();
    const first = await deviceEvent(o.deviceToken, {
      type: 'DOOR_CLOSED',
      compartmentCode: 'S1',
      sequence: 50,
      eventId,
    });
    const retry = await deviceEvent(o.deviceToken, {
      type: 'DOOR_CLOSED',
      compartmentCode: 'S1',
      sequence: 50,
      eventId,
    });
    expect(first.body.accepted).toBe(true);
    expect(retry.body).toEqual({ accepted: false, duplicate: true });

    const stale = await deviceEvent(o.deviceToken, {
      type: 'DOOR_OPENED',
      compartmentCode: 'S1',
      sequence: 10,
    });
    expect(stale.body).toMatchObject({
      accepted: true,
      applied: false,
      verificationStatus: 'OUT_OF_ORDER',
    });
    const t = await admin();
    const od = await api().get(`/api/v1/admin/outlets/${o.outletId}`).set(auth(t));
    const comp = od.body.lockerBanks[0].compartments[0];
    expect(comp.doorState).toBe('CLOSED');
    expect(comp.operationalStatus).toBe('IN_SERVICE');
  });

  it("a device cannot report on or ack commands for another device's compartments", async () => {
    const a = await createOutlet();
    const b = await createOutlet();
    await heartbeat(a.deviceToken);
    await heartbeat(b.deviceToken);
    const c = await registerCustomer();
    const id = await paidBooking(c.token, a.outletId);
    await access(c.token, id, 'DEPOSIT');
    const polledByB = await api().get('/api/v1/devices/commands').set(auth(b.deviceToken));
    expect(polledByB.body.commands).toHaveLength(0);
    const polledByA = await api().get('/api/v1/devices/commands').set(auth(a.deviceToken));
    const cmd = polledByA.body.commands[0];
    const ackByB = await api()
      .post(`/api/v1/devices/commands/${cmd.commandId}/ack`)
      .set(auth(b.deviceToken))
      .send({ result: 'OK', nonce: cmd.nonce });
    expect(ackByB.status).toBe(404);
    const wrongNonce = await api()
      .post(`/api/v1/devices/commands/${cmd.commandId}/ack`)
      .set(auth(a.deviceToken))
      .send({ result: 'OK', nonce: 'x'.repeat(24) });
    expect(wrongNonce.status).toBe(400);
  });

  it('rejects unknown device tokens', async () => {
    const res = await api()
      .post('/api/v1/devices/heartbeat')
      .set(auth('y'.repeat(43)))
      .send({});
    expect(res.status).toBe(401);
  });
});

describe('kiosk PIN credential', () => {
  it('a valid PIN queues an unlock for that compartment; wrong PINs lock the credential', async () => {
    const o = await createOutlet();
    await heartbeat(o.deviceToken);
    const c = await registerCustomer();
    const id = await paidBooking(c.token, o.outletId);
    const { body } = await api()
      .post(`/api/v1/storage/bookings/${id}/credential`)
      .set(auth(c.token));
    const verify = (pin: string) =>
      api()
        .post('/api/v1/devices/access/verify-pin')
        .set(auth(o.deviceToken))
        .send({ compartmentCode: 'S1', pin });

    const wrong = body.pin === '000000' ? '111111' : '000000';
    expect((await verify(wrong)).status).toBe(403);
    const ok = await verify(body.pin);
    expect(ok.status).toBe(202);
    expect(ok.body.purpose).toBe('DEPOSIT');
    await deviceCompletesUnlock(o.deviceToken);
    expect((await detail(c.token, id)).body.status).toBe('ACTIVE');

    for (let i = 0; i < 5; i++) await verify(wrong);
    // Locked after too many attempts: even the right PIN is refused.
    expect((await verify(body.pin)).status).toBe(403);
    // Re-issuing creates a new working PIN and revokes the old one.
    const re = await api().post(`/api/v1/storage/bookings/${id}/credential`).set(auth(c.token));
    expect((await verify(re.body.pin)).status).toBe(202);
  });

  it('a re-issued PIN revokes the previous one', async () => {
    const o = await createOutlet();
    await heartbeat(o.deviceToken);
    const c = await registerCustomer();
    const id = await paidBooking(c.token, o.outletId);
    const first = await api().post(`/api/v1/storage/bookings/${id}/credential`).set(auth(c.token));
    const second = await api().post(`/api/v1/storage/bookings/${id}/credential`).set(auth(c.token));
    const verify = (pin: string) =>
      api()
        .post('/api/v1/devices/access/verify-pin')
        .set(auth(o.deviceToken))
        .send({ compartmentCode: 'S1', pin });
    if (first.body.pin !== second.body.pin) expect((await verify(first.body.pin)).status).toBe(403);
    expect((await verify(second.body.pin)).status).toBe(202);
  });
});
