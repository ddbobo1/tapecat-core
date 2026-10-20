/**
 * Creates `.env` from `.env.example` (if missing) and fills a fresh keeper EOA:
 * KEEPER_PRIVATE_KEY + INITIAL_KEEPERS. Never prints the key. Refuses to overwrite an existing key.
 */
import { existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const path = ".env";
if (!existsSync(path)) copyFileSync(".env.example", path);
let text = readFileSync(path, "utf8");

const current = text.match(/^KEEPER_PRIVATE_KEY=(.*)$/m)?.[1]?.trim();
if (current) {
  console.log(`KEEPER_PRIVATE_KEY already set; keeper = ${privateKeyToAccount(current as `0x${string}`).address}`);
  process.exit(0);
}

const key = generatePrivateKey();
const address = privateKeyToAccount(key).address;
const set = (name: string, value: string) => {
  text = new RegExp(`^${name}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`)
    : `${text.trimEnd()}\n${name}=${value}\n`;
};
set("KEEPER_PRIVATE_KEY", key);
const keepers = (text.match(/^INITIAL_KEEPERS=(.*)$/m)?.[1] || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!keepers.some((k) => k.toLowerCase() === address.toLowerCase())) keepers.push(address);
set("INITIAL_KEEPERS", keepers.join(","));
writeFileSync(path, text);
console.log(`keeper = ${address}`);
