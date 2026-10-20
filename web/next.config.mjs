/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel / Node server (same-origin /api). Do NOT use output:'export' for production.
  trailingSlash: true,
  turbopack: { root: import.meta.dirname },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      { source: '/join', destination: '/invite', permanent: false },
      { source: '/join/', destination: '/invite/', permanent: false },
      { source: '/claim', destination: '/waitlist', permanent: false },
      { source: '/claim/', destination: '/waitlist/', permanent: false },
      { source: '/risk', destination: '/', permanent: false },
      { source: '/risk/', destination: '/', permanent: false },
    ]
  },
}

// Local `next dev`: proxy /api → local verifier when NEXT_PUBLIC_VERIFIER_URL unset.
if (process.env.NODE_ENV !== 'production') {
  nextConfig.rewrites = async () => {
    if (process.env.NEXT_PUBLIC_VERIFIER_URL) return []
    const verifier = process.env.VERIFIER_URL || 'http://localhost:8787'
    return [{ source: '/api/:path*', destination: `${verifier}/api/:path*` }]
  }
}

export default nextConfig
