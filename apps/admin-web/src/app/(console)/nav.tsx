'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/outlets', label: 'Outlets' },
  { href: '/devices', label: 'Devices' },
  { href: '/bookings', label: 'Bookings' },
  { href: '/audit', label: 'Audit log' },
];

export function Nav() {
  const path = usePathname();
  async function signOut() {
    await fetch('/api/session', { method: 'DELETE', headers: { 'x-admin-web': '1' } });
    window.location.href = '/login';
  }
  return (
    <aside className="sidebar">
      <div className="brand">Smart Locker Admin</div>
      <nav className="nav" aria-label="Main">
        {LINKS.map((l) => {
          const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}>
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div style={{ flex: 1 }} />
      <button onClick={signOut}>Sign out</button>
    </aside>
  );
}
