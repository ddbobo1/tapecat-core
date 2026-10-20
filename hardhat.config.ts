import "dotenv/config";
import "@nomicfoundation/hardhat-toolbox";
import type { HardhatUserConfig } from "hardhat/config";

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = deployerKey ? [deployerKey] : [];

// Success-path sale tests need 200 contributor wallets (1.5 BEM cap × 200 = MIN_RAISE).
const HARDHAT_ACCOUNTS = { count: 210 };

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: process.env.FORK_URL
      ? {
          accounts: HARDHAT_ACCOUNTS,
          forking: { url: process.env.FORK_URL, blockNumber: process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined },
        }
      : { accounts: HARDHAT_ACCOUNTS },
    bsc: {
      url: process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org",
      chainId: 56,
      accounts,
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-dataseed.bnbchain.org",
      chainId: 97,
      accounts,
    },
  },
  etherscan: {
    apiKey: process.env.BSCSCAN_API_KEY || "",
  },
  mocha: { timeout: 300_000 },
};

export default config;
