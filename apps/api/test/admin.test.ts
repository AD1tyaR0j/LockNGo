import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '../src/db/client.js';
import { admin, api, auth, createOutlet, heartbeat, paidBooking, quote, registerCustomer } from './helpers.js';

afterAll(closeDb);

describe('admin inventory and compartment control', () => {
  it('disabling a faulty compartment removes it from availability and reports affected bookings', async () => {
    const o = await createOutlet([
      { code: 'S1', size: 'S' },
      { code: 'S2', size: 'S' },
    ]);
    const t = await admin();
    const c = await registerCustomer();
    const bookingId = await paidBooking(c.token, o.outletId);
    const booked = await api().get(`/api/v1/storage/bookings/${bookingId}`).set(auth(c.token));
    const bookedCode = booked.body.compartment.code as string;
    const freeCode = bookedCode === 'S1' ? 'S2' : 'S1';

    const disableFree = await api()
      .post(`/api/v1/admin/compartments/${o.compartmentIds[freeCode]}/status`)
      .set(auth(t))
      .send({ action: 'DISABLE', reason: 'Hinge damaged' });
    expect(disableFree.status).toBe(200);
    expect(disableFree.body.affectedBookings).toHaveLength(0);
    const avail = await api().get(`/api/v1/outlets/${o.outletId}/availability`);
    expect(avail.body.sizes).toEqual([{ size: 'S', total: 2, available: 0 }]);

    const disableBooked = await api()
      .post(`/api/v1/admin/compartments/${o.compartmentIds[bookedCode]}/status`)
      .set(auth(t))
      .send({ action: 'DISABLE', reason: 'Lock sensor fault' });
    expect(disableBooked.body.affectedBookings.map((b: { id: string }) => b.id)).toEqual([bookingId]);

    // The customer can no longer be let into an out-of-service compartment.
    await heartbeat(o.deviceToken);
    const acc = await api()
      .post(`/api/v1/storage/bookings/${bookingId}/access`)
      .set(auth(c.token))
      .send({ purpose: 'DEPOSIT' });
    expect(acc.status).toBe(409);
    expect(acc.body.error.code).toBe('COMPARTMENT_UNAVAILABLE');

    // Invalid transition is rejected; valid return-to-service works.
    const again = await api()
      .post(`/api/v1/admin/compartments/${o.compartmentIds[freeCode]}/status`)
      .set(auth(t))
      .send({ action: 'DISABLE', reason: 'again' });
    expect(again.status).toBe(409);
    const back = await api()
      .post(`/api/v1/admin/compartments/${o.compartmentIds[freeCode]}/status`)
      .set(auth(t))
      .send({ action: 'RETURN_TO_SERVICE', reason: 'Hinge replaced and tested' });
    expect(back.body.operationalStatus).toBe('IN_SERVICE');
    const c2 = await registerCustomer();
    expect((await quote(c2.token, o.outletId)).status).toBe(201);
  });

  it('records audit events for sensitive actions and exposes them to admins', async () => {
    const o = await createOutlet();
    const t = await admin();
    await api()
      .post(`/api/v1/admin/compartments/${o.compartmentIds.S1}/status`)
      .set(auth(t))
      .send({ action: 'MARK_NEEDS_INSPECTION', reason: 'Routine check' });
    const res = await api()
      .get('/api/v1/admin/audit')
      .query({ resourceType: 'compartment', resourceId: o.compartmentIds.S1 })
      .set(auth(t));
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      action: 'compartment.status_changed',
      actorType: 'USER',
      metadata: { from: 'IN_SERVICE', to: 'NEEDS_INSPECTION', reason: 'Routine check' },
    });
    const dev = await api().get('/api/v1/admin/audit').query({ resourceId: o.deviceId }).set(auth(t));
    expect(dev.body.items.map((a: { action: string }) => a.action)).toContain('device.registered');
  });

  it('audit logs and booking events are append-only at the database level', async () => {
    await createOutlet();
    const appendOnly = { cause: { message: expect.stringMatching(/append-only/) } };
    await expect(getDb().execute(sql`UPDATE audit_logs SET action = 'tampered'`)).rejects.toMatchObject(appendOnly);
    await expect(getDb().execute(sql`DELETE FROM audit_logs`)).rejects.toMatchObject(appendOnly);
    await expect(getDb().execute(sql`DELETE FROM booking_events`)).rejects.toMatchObject(appendOnly);
  });

  it('device tokens are returned once and never stored in plaintext', async () => {
    const o = await createOutlet();
    const rows = await getDb().execute<{ credential_hash: string }>(
      sql`SELECT credential_hash FROM devices WHERE id = ${o.deviceId}`,
    );
    expect(rows.rows[0]!.credential_hash).not.toContain(o.deviceToken);
    expect(rows.rows[0]!.credential_hash).toMatch(/^[0-9a-f]{64}$/);
    const t = await admin();
    const list = await api().get('/api/v1/admin/devices').set(auth(t));
    expect(JSON.stringify(list.body)).not.toContain(o.deviceToken);
    expect(list.body.items.find((d: { id: string }) => d.id === o.deviceId).isSimulated).toBe(true);
  });

  it('public outlet APIs flag simulated hardware and hide device identifiers', async () => {
    const o = await createOutlet();
    const res = await api().get(`/api/v1/outlets/${o.outletId}`);
    expect(res.body.hasSimulatedDevices).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/SIM-|deviceIdentifier|credential/);
  });

  it('draft outlets are not publicly visible', async () => {
    const t = await admin();
    const o = await createOutlet();
    await api().patch(`/api/v1/admin/outlets/${o.outletId}`).set(auth(t)).send({ status: 'DRAFT' });
    expect((await api().get(`/api/v1/outlets/${o.outletId}`)).status).toBe(404);
    const c = await registerCustomer();
    expect((await quote(c.token, o.outletId)).status).toBe(404);
  });

  it('booking search and detail for staff; detail views are audited', async () => {
    const o = await createOutlet();
    const t = await admin();
    const c = await registerCustomer();
    const id = await paidBooking(c.token, o.outletId);
    const d = await api().get(`/api/v1/storage/bookings/${id}`).set(auth(c.token));
    const search = await api().get('/api/v1/admin/bookings').query({ q: d.body.reference }).set(auth(t));
    expect(search.body.items).toHaveLength(1);
    const staffView = await api().get(`/api/v1/admin/bookings/${id}`).set(auth(t));
    expect(staffView.status).toBe(200);
    const a = await api()
      .get('/api/v1/admin/audit')
      .query({ action: 'booking.viewed_by_staff', resourceId: id })
      .set(auth(t));
    expect(a.body.total).toBe(1);
  });

  it('overview reports simulated vs physical device counts', async () => {
    await createOutlet();
    const t = await admin();
    const res = await api().get('/api/v1/admin/overview').set(auth(t));
    expect(res.status).toBe(200);
    expect(res.body.devices.simulated).toBeGreaterThan(0);
    expect(res.body.devices.physical).toBe(0);
  });
});
