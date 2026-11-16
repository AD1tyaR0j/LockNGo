import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '../src/db/client.js';
import { admin, api, auth, createStaff, registerCustomer } from './helpers.js';

afterAll(closeDb);

describe('authentication', () => {
  it('registers a customer and returns only the CUSTOMER role, ignoring client-supplied roles', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({
        name: 'Sneaky',
        email: `sneaky-${Date.now()}@test.local`,
        password: 'correct-horse-battery',
        roles: ['SUPER_ADMIN'],
      });
    expect(res.status).toBe(201);
    expect(res.body.user.roles).toEqual(['CUSTOMER']);
    expect(res.body.user.permissions).toEqual(['storage:book']);
  });

  it('rejects duplicate emails case-insensitively without detail', async () => {
    const c = await registerCustomer();
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Dup', email: c.email.toUpperCase(), password: 'correct-horse-battery' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGISTRATION_FAILED');
  });

  it('uses the same error for unknown email and wrong password', async () => {
    const c = await registerCustomer();
    const wrong = await api().post('/api/v1/auth/login').send({ email: c.email, password: 'nope-nope-nope' });
    const unknown = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe(unknown.body.error.code);
  });

  it('logout revokes the session token', async () => {
    const c = await registerCustomer();
    expect((await api().get('/api/v1/me').set(auth(c.token))).status).toBe(200);
    expect((await api().post('/api/v1/auth/logout').set(auth(c.token))).status).toBe(204);
    expect((await api().get('/api/v1/me').set(auth(c.token))).status).toBe(401);
  });

  it('rejects requests with no or garbage tokens', async () => {
    expect((await api().get('/api/v1/me')).status).toBe(401);
    expect((await api().get('/api/v1/me').set(auth('x'.repeat(43)))).status).toBe(401);
  });
});

describe('role permissions', () => {
  it('customers cannot reach admin endpoints', async () => {
    const c = await registerCustomer();
    for (const path of ['/api/v1/admin/overview', '/api/v1/admin/bookings', '/api/v1/admin/audit']) {
      const res = await api().get(path).set(auth(c.token));
      expect(res.status, path).toBe(403);
    }
    const create = await api().post('/api/v1/admin/outlets').set(auth(c.token)).send({});
    expect(create.status).toBe(403);
  });

  it('support agents can read bookings but cannot change inventory or read the audit log', async () => {
    const s = await createStaff('SUPPORT_AGENT');
    expect((await api().get('/api/v1/admin/bookings').set(auth(s.token))).status).toBe(200);
    expect((await api().get('/api/v1/admin/audit').set(auth(s.token))).status).toBe(403);
    expect((await api().post('/api/v1/admin/outlets').set(auth(s.token)).send({})).status).toBe(403);
  });

  it('staff without CUSTOMER role cannot create bookings', async () => {
    const t = await admin();
    const res = await api().post('/api/v1/storage/quotes').set(auth(t)).send({});
    expect(res.status).toBe(403);
  });

  it('user session tokens are not accepted on the device API', async () => {
    const c = await registerCustomer();
    const res = await api().get('/api/v1/devices/commands').set(auth(c.token));
    expect(res.status).toBe(401);
  });
});
