/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable output file tracing — App Router-only project.
  // Next.js 14 collect-build-traces looks for pages router nft.json files
  // which don't exist in an App Router-only project, causing ENOENT build errors.
  outputFileTracing: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.com',
        pathname: '/storage/v1/object/**',
      },
      {
        protocol: 'https',
        hostname: 'image.mux.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.mux.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'api.mapbox.com',
        pathname: '/**',
      },
    ],
  },
  // Required for @react-pdf/renderer server-side rendering.
  // NOTE: `serverExternalPackages` is Next.js 15+ syntax.
  // In Next.js 14.x, this lives under `experimental.serverComponentsExternalPackages`.
  experimental: {
    serverComponentsExternalPackages: ['@react-pdf/renderer'],
  },
};

module.exports = nextConfig;
