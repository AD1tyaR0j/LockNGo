'use client';

import { useState, type FormEvent } from 'react';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-web': '1' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? 'Sign-in failed');
        return;
      }
      window.location.href = '/';
    } catch {
      setError('Network error — is the admin server running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="card stack">
        <div>
          <h1>Smart Locker Admin</h1>
          <p className="muted">Staff sign-in. Customer accounts cannot access this console.</p>
        </div>
        <form className="stack" onSubmit={submit}>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error ? (
            <div className="alert error" role="alert">
              {error}
            </div>
          ) : null}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
