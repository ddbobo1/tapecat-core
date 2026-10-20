/**
 * Post-raise transparency: { wallet, xIdHash, cap } for every signed allocation, merged with on-chain
 * contributions (contributors the verifier never signed for are flagged). Builds an OpenZeppelin
 * StandardMerkleTree over (address wallet, bytes32 xIdHash, uint256 cap), writes out/allowlist.json,
 * optionally pins it to IPFS via Pinata (PINATA_JWT), and prints the Safe call to publishAllowlist.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { createPublicClient, encodeFunctionData, getAddress, http, type Address } from "viem";
import { bsc } from "viem/chains";
import { saleAbi } from "../shared/abi";

const sale = process.env.SALE_ADDRESS as Address;
const fromBlock = BigInt(process.env.SALE_DEPLOY_BLOCK || "0");
const step = BigInt(process.env.LOG_STEP || "5000");
const client = createPublicClient({ chain: bsc, transport: http(process.env.BSC_RPC_URL) });

async function main() {
  if (!sale) throw new Error("SALE_ADDRESS required");
  const db = new DatabaseSync(join(process.env.VERIFIER_DATA_DIR || "verifier/data", "verifier.sqlite"), { readOnly: true });
  const signed = db
    .prepare("SELECT wallet, x_id_hash, MAX(CAST(cap AS INTEGER)) AS cap FROM signatures GROUP BY wallet, x_id_hash")
    .all() as { wallet: string; x_id_hash: string; cap: number }[];

  const latest = await client.getBlockNumber();
  const contributed = new Map<string, { xIdHash: string; amount: bigint }>();
  const event = saleAbi.find((x) => x.type === "event" && x.name === "Contributed")!;
  for (let b = fromBlock; b <= latest; b += step) {
    const to = b + step - 1n > latest ? latest : b + step - 1n;
    const logs = await client.getLogs({ address: sale, event: event as never, fromBlock: b, toBlock: to });
    for (const l of logs as unknown as { args: { user: Address; xIdHash: string; amount: bigint } }[]) {
      const k = l.args.user.toLowerCase();
      const prev = contributed.get(k);
      contributed.set(k, { xIdHash: l.args.xIdHash, amount: (prev?.amount ?? 0n) + l.args.amount });
    }
  }

  const entries = signed.map((s) => ({
    wallet: getAddress(s.wallet),
    xIdHash: s.x_id_hash,
    cap: BigInt(s.cap).toString(),
    contributed: (contributed.get(s.wallet.toLowerCase())?.amount ?? 0n).toString(),
  }));
  const known = new Set(signed.map((s) => s.wallet.toLowerCase()));
  const unknown = [...contributed.entries()]
    .filter(([w]) => !known.has(w))
    .map(([w, v]) => ({ wallet: getAddress(w), xIdHash: v.xIdHash, contributed: v.amount.toString() }));

  const tree = StandardMerkleTree.of(
    entries.map((e) => [e.wallet, e.xIdHash, e.cap]),
    ["address", "bytes32", "uint256"],
  );
  const doc = {
    sale,
    chainId: 56,
    generatedAt: new Date().toISOString(),
    leafEncoding: ["address", "bytes32", "uint256"],
    merkleRoot: tree.root,
    entries,
    contributorsWithoutVerifierSignature: unknown,
    tree: tree.dump(),
  };

  mkdirSync("out", { recursive: true });
  writeFileSync("out/allowlist.json", JSON.stringify(doc, null, 2));
  console.log(`entries=${entries.length} unknownContributors=${unknown.length} root=${tree.root}`);

  let cid = process.env.ALLOWLIST_CID || "";
  if (!cid && process.env.PINATA_JWT) {
    const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.PINATA_JWT}`, "content-type": "application/json" },
      body: JSON.stringify({ pinataContent: doc, pinataMetadata: { name: "tapecat-allowlist.json" } }),
    });
    if (!res.ok) throw new Error(`pinata ${res.status}: ${await res.text()}`);
    cid = ((await res.json()) as { IpfsHash: string }).IpfsHash;
    console.log(`pinned ipfs://${cid}`);
  }
  if (cid) {
    const data = encodeFunctionData({ abi: saleAbi, functionName: "publishAllowlist", args: [tree.root as `0x${string}`, cid] });
    writeFileSync("out/safe-publishAllowlist.json", JSON.stringify({ to: sale, value: "0", data }, null, 2));
    console.log("Safe transaction written to out/safe-publishAllowlist.json");
  } else {
    console.log("Upload out/allowlist.json to IPFS, then rerun with ALLOWLIST_CID=<cid> to get the Safe transaction.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
