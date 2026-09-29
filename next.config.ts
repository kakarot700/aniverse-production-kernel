import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev previews are served from a proxied hostname (Codespaces, e2b, ngrok,
  // tunnels). Without this, Next 15 rejects the cross-origin dev asset
  // requests and the preview renders unstyled or not at all.
  allowedDevOrigins: ['*.e2b.app', '*.app.github.dev', '*.ngrok-free.app', '*.trycloudflare.com'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Note: no X-Frame-Options / frame-ancestors here so the app stays
          // embeddable in hosted dev previews. Add a frame-ancestors CSP in
          // your edge/CDN config for production if you need clickjacking
          // protection.
        ],
      },
    ];
  },
};

export default nextConfig;
