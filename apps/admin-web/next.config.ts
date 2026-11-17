import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/**
 * The browser only ever talks to this app (the BFF proxies the API server-side), so
 * connect-src can be 'self'. Next.js inline bootstrap scripts need 'unsafe-inline' without a
 * nonce setup; dev mode additionally needs 'unsafe-eval' for fast refresh.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${isProd ? '' : ' ws:'}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const config: NextConfig = {
  transpilePackages: ['@sl/shared'],
  poweredByHeader: false,
  // Only ADMIN_API_URL is read, and only on the server (route handlers). Nothing is exposed via NEXT_PUBLIC_*.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isProd
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
        ],
      },
    ];
  },
};
export default config;
