import { encodePacked, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const allocationTypes = {
  Allocation: [
    { name: "wallet", type: "address" },
    { name: "xIdHash", type: "bytes32" },
    { name: "cap", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** keccak256(saleSaltText) is what the deploy script stores on-chain as `saleSalt`. */
export const saleSaltOf = (text: string) => keccak256(toHex(text));

/** xIdHash = keccak256(abi.encodePacked(bytes32 saleSalt, string xUserId)). De-identification only; X ids are enumerable. */
export const xIdHashOf = (saleSalt: Hex, xUserId: string) => keccak256(encodePacked(["bytes32", "string"], [saleSalt, xUserId]));

/** Short code users can put in a quote tweet as a retweet fallback. */
export const shortCodeOf = (saleSalt: Hex, wallet: Address) =>
  "tc-" + keccak256(encodePacked(["bytes32", "address"], [saleSalt, wallet])).slice(2, 8);

/**
 * Plan A: a single server signer. Swap this for a KMS/HSM-backed implementation in production
 * (same interface); the on-chain signer can be rotated by the Safe via setSigner.
 */
export interface AllocationSigner {
  address: Address;
  sign(msg: { wallet: Address; xIdHash: Hex; cap: bigint; deadline: bigint }): Promise<Hex>;
}

export function localSigner(privateKey: Hex, chainId: number, sale: Address): AllocationSigner {
  const account = privateKeyToAccount(privateKey);
  const domain = { name: "tapecat-sale", version: "1", chainId, verifyingContract: sale } as const;
  return {
    address: account.address,
    sign: (message) => account.signTypedData({ domain, types: allocationTypes, primaryType: "Allocation", message }),
  };
}
