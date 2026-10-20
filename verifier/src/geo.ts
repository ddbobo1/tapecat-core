import type { Request, Response, NextFunction } from "express";
import { config } from "./config";

/**
 * Country comes from the CDN in front of the server (Cloudflare `CF-IPCountry` by default).
 * Front-end blocking only: the contracts stay callable by anyone.
 */
export function countryOf(req: Request): string {
  if (config.geo.devCountry) return config.geo.devCountry.toUpperCase();
  const v = req.headers[config.geo.header];
  return (Array.isArray(v) ? v[0] : v || "").toUpperCase();
}

export function isBlocked(country: string): boolean {
  if (!country || country === "XX" || country === "T1") return !config.geo.allowUnknown;
  return config.geo.blocked.includes(country);
}

export function geoGuard(req: Request, res: Response, next: NextFunction) {
  const c = countryOf(req);
  if (isBlocked(c)) {
    res.status(451).json({ error: "region_restricted", country: c || null });
    return;
  }
  next();
}
