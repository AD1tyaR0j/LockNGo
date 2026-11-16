import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { apiBase, SESSION_COOKIE } from '@/lib/server';
import { Nav } from './nav';

export const dynamic = 'force-dynamic';

/** Ask the API whether payments are mocked, rather than guessing from this app's build mode. */
async function paymentsAreMock(): Promise<boolean | null> {
  try {
    const res = await fetch(`${apiBase()}/health`, { cache: 'no-store' });
    const body = await res.json();
    return Boolean(body.paymentsAreMock);
  } catch {
    return null;
  }
}

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  // Cookie presence only gates navigation; every data request is authorised by the API.
  if (!(await cookies()).get(SESSION_COOKIE)) redirect('/login');
  const mock = await paymentsAreMock();
  return (
    <>
      {mock !== false ? (
        <div className="env-banner" role="status">
          {mock === null
            ? 'API unreachable — data below may fail to load'
            : 'NON-PRODUCTION · Payments are MOCKED (no money moves) · Lockers marked SIMULATED have no physical hardware'}
        </div>
      ) : null}
      <div className="shell">
        <Nav />
        <main className="main">{children}</main>
      </div>
    </>
  );
}
