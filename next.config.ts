import type { NextConfig } from 'next';

/**
 * Security headers.
 *
 * Deliberately *no* `X-Frame-Options` / `frame-ancestors` directives: the app has to stay
 * embeddable by hosted preview/proxy environments during development. A production
 * deployment should add a `frame-ancestors` allow-list via its own edge configuration.
 * See docs/DECISIONS.md → ADR-0009.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
] as const;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // `typedRoutes` is intentionally off: it depends on generated files in `.next/`, which would make
  // `tsc --noEmit` order-dependent (see docs/DECISIONS.md → ADR-0003). Route integrity is instead
  // covered by tests that assert every navigation target resolves to a real page file.
  // `next build` must keep type-checking enabled — it is part of the quality gate.
  typescript: { ignoreBuildErrors: false },
  async headers() {
    return [{ source: '/:path*', headers: [...securityHeaders] }];
  },
};

export default nextConfig;
