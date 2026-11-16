import type { NextConfig } from 'next';

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
        ],
      },
    ];
  },
};
export default config;
