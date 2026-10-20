/**
 * Browser base URL for the verifier.
 * - Empty (default / production Vercel): same-origin `/api/…`
 * - Local `next dev`: also empty — Next rewrites `/api` → VERIFIER_URL
 * - Legacy split (HashPort): `NEXT_PUBLIC_VERIFIER_URL=https://api.example.com`
 */
export const VERIFIER_BASE = (process.env.NEXT_PUBLIC_VERIFIER_URL || '').replace(/\/$/, '')

/** Resolve an API path (`/api/...`) against VERIFIER_BASE. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const p = path.startsWith('/') ? path : `/${path}`
  return `${VERIFIER_BASE}${p}`
}
