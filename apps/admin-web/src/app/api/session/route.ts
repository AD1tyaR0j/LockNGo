import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { apiBase, CSRF_HEADER, SESSION_COOKIE, STAFF_PERMISSIONS } from '@/lib/server';

export async function POST(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== '1') {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Missing header' } }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const res = await fetch(`${apiBase()}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: body?.email, password: body?.password }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  const perms: string[] = data.user.permissions;
  if (!STAFF_PERMISSIONS.some((p) => perms.includes(p))) {
    // Revoke the session we just created: this account may not use the console.
    await fetch(`${apiBase()}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${data.token}` },
    });
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'This account does not have staff access' } },
      { status: 403 },
    );
  }
  (await cookies()).set(SESSION_COOKIE, data.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: new Date(data.expiresAt),
  });
  return NextResponse.json({ user: data.user });
}

export async function DELETE(req: NextRequest) {
  if (req.headers.get(CSRF_HEADER) !== '1') {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Missing header' } }, { status: 403 });
  }
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await fetch(`${apiBase()}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  jar.delete(SESSION_COOKIE);
  return new NextResponse(null, { status: 204 });
}
