/**
 * Smoke test of a running verifier (default http://localhost:8787) with Hardhat's
 * published default account #6 (a public test key, not a project secret):
 * geo, config, SIWE sign-in, /api/me, allocation gating, X login redirect, keeper plan.
 * Point VERIFIER_URL at the web app (e.g. http://localhost:3000) to test through the Next.js proxy.
 */
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const base = process.env.VERIFIER_URL || "http://localhost:8787";
const acct = privateKeyToAccount("0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e");
let cookie = "";

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(base + path, {
    redirect: "manual",
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers || {}) },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  return { status: res.status, text, location: res.headers.get("location") };
}

async function main() {
  const check = (name: string, ok: boolean, detail = "") => console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);

  const geo = await call("/api/geo");
  check("geo", geo.status === 200 && JSON.parse(geo.text).blocked === false, geo.text);

  const cfg = await call("/api/config");
  check("config", cfg.status === 200 && cfg.text.includes('"sale"'), cfg.text.slice(0, 80) + "…");

  const n = JSON.parse((await call("/api/siwe/nonce")).text);
  const message = createSiweMessage({
    address: acct.address,
    chainId: n.chainId,
    domain: n.domain,
    nonce: n.nonce,
    uri: n.uri,
    version: "1",
    issuedAt: new Date(),
  });
  const signature = await acct.signMessage({ message });
  const v = await call("/api/siwe/verify", { method: "POST", body: JSON.stringify({ message, signature }) });
  check("siwe verify", v.status === 200 && v.text.includes(acct.address), v.text);

  const replay = await call("/api/siwe/verify", { method: "POST", body: JSON.stringify({ message, signature }) });
  check("siwe nonce single-use", replay.status === 400, replay.text);

  const me = await call("/api/me");
  check("me", me.status === 200 && me.text.includes("shortCode"), me.text);

  const a1 = await call("/api/allocation", { method: "POST", body: JSON.stringify({}) });
  check("allocation requires terms", a1.status === 400 && a1.text.includes("accept_terms"), a1.text);
  const a2 = await call("/api/allocation", { method: "POST", body: JSON.stringify({ acceptTerms: true, termsVersion: "v0.10" }) });
  check("allocation requires X", a2.status === 401 && a2.text.includes("connect_x_first"), a2.text);

  const x = await call("/api/x/login");
  check("x login redirect", x.status === 302 && !!x.location?.startsWith("https://x.com/i/oauth2/authorize"), x.location?.slice(0, 90));

  const plan = await call("/api/keeper/plan");
  check("keeper plan", plan.status === 200, plan.text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
