import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { apiBase, CSRF_HEADER, SESSION_COOKIE } from '@/lib/server';

/**
 * Forwards browser requests to the backend's admin namespace (and /me) with the session token.
 * The allowlist keeps this from becoming an open proxy onto customer or device endpoints.
 */
const ALLOWED = /^(admin\/[A-Za-z0-9/_-]+|me)$/;

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join('/');
  if (!ALLOWED.test(joined)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
  }
  if (req.method !== 'GET' && req.headers.get(CSRF_HEADER) !== '1') {
    return NextResponse.json({ error: { code: 'CSRF', message: 'Missing header' } }, { status: 403 });
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, { status: 401 });
  }
  const target = `${apiBase()}/api/v1/${joined}${req.nextUrl.search}`;
  const res = await fetch(target, {
    method: req.method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(req.headers.get('x-request-id') ? { 'x-request-id': req.headers.get('x-request-id')! } : {}),
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
    cache: 'no-store',
  });
  const text = await res.text();
  return new NextResponse(text || null, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export { forward as GET, forward as POST, forward as PATCH };
