import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Dev-server origin allowlist.
   *
   * Next 15 rejects cross-origin dev requests unless the host is listed, which
   * breaks any proxied preview (Codespaces, e2b/Arena sandboxes, ngrok, a LAN
   * IP). `ANIVERSE_DEV_ORIGINS` is a comma-separated list of extra hostnames.
   */
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '*.e2b.app',
    '*.app.github.dev',
    '*.gitpod.io',
    '*.ngrok-free.app',
    ...(process.env.ANIVERSE_DEV_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? []),
  ],

  async headers() {
    const baseHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ];

    /**
     * Clickjacking protection is expressed as `frame-ancestors` rather than
     * `X-Frame-Options` so hosted previews (which legitimately iframe the dev
     * server) keep working. Set `ANIVERSE_FRAME_ANCESTORS` to lock production
     * down, e.g. `'self'` or `'self' https://admin.example.com`.
     */
    const frameAncestors = process.env.ANIVERSE_FRAME_ANCESTORS?.trim();
    if (frameAncestors) {
      baseHeaders.push({ key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}` });
    }

    return [{ source: '/:path*', headers: baseHeaders }];
  },
};

export default nextConfig;
