import { config } from "./config";
import { createApp, warmupSale } from "./app";
import { requireSaleConfig } from "./config";

async function main() {
  // Local/dev: fail fast if sale secrets are set but incomplete; allow boot without SALE_ADDRESS.
  if (config.sale || config.signerKey || config.saleSaltText) {
    try {
      requireSaleConfig();
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  } else {
    console.warn("SALE_ADDRESS unset — /api/health and /api/geo work; signing routes return 503");
  }

  await warmupSale();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(
      `verifier on :${config.port}  sale=${config.sale || "(unset)"}  chain=${config.chainId}  frontend=${config.frontendOrigin}  api=${config.apiOrigin}  sameSite=${config.cookieSameSite}  db=${config.tursoUrl.startsWith("file:") ? "file" : "turso"}`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
