import type { NextConfig } from 'next'

// Served from a sub-path in production (intm.kr/floorplan) but from the root
// in local dev, so this stays env-gated — hardcoding it would break the dev
// server's existing scene URLs.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined

// Local dev only. In production this app is served at intm.kr/floorplan and the
// component API lives at intm.kr/api/sketchup — same origin, so the panel's
// root-absolute `/api/sketchup/...` just works. In dev the two run on different
// ports, which would make every call cross-origin and drop the INTM session
// cookie that the edit actions need. Proxying keeps it same-origin instead.
const componentApiOrigin = process.env.COMPONENT_API_ORIGIN

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  ...(componentApiOrigin
    ? {
        rewrites: async () => [
          {
            source: '/api/sketchup/:path*',
            destination: `${componentApiOrigin}/api/sketchup/:path*`,
          },
        ],
      }
    : {}),
  logging: {
    browserToTerminal: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    'three',
    '@pascal-app/viewer',
    '@pascal-app/core',
    '@pascal-app/editor',
    '@pascal-app/mcp',
    '@pascal-app/plugin-trees',
    '@dgreenheck/ez-tree',
  ],
  turbopack: {
    resolveAlias: {
      react: './node_modules/react',
      three: './node_modules/three',
      '@react-three/fiber': './node_modules/@react-three/fiber',
      '@react-three/drei': './node_modules/@react-three/drei',
    },
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  images: {
    unoptimized: process.env.NEXT_PUBLIC_ASSETS_CDN_URL?.startsWith('http://localhost') ?? false,
    // Only under a basePath: see image-loader.ts. A custom loader is the one
    // place that reaches every <Image> without editing call sites.
    ...(basePath ? { loader: 'custom' as const, loaderFile: './image-loader.ts' } : {}),
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
}

export default nextConfig
