/**
 * hardhat.config.ts
 * Complete Hardhat configuration for FHEVM development.
 *
 * Quick start:
 *   1. cp this file to your project root as hardhat.config.ts
 *   2. npm install (use the package.json template)
 *   3. npx hardhat vars set MNEMONIC
 *   4. npx hardhat vars set INFURA_KEY
 *   5. npx hardhat test
 *
 * Secrets are stored via `npx hardhat vars` — never in .env for this setup.
 * If you prefer .env, replace vars.get(...) with process.env.X ?? ""
 */

import { HardhatUserConfig, vars } from "hardhat/config";
import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-toolbox";

// ── Optional: load .env if present (alternative to hardhat vars) ──────────────
// import * as dotenv from "dotenv";
// dotenv.config();

const config: HardhatUserConfig = {
  // ── Solidity ────────────────────────────────────────────────────────────────
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // "cancun" is required for EIP-1153 transient storage used by ACL allowTransient
      evmVersion: "cancun",
      viaIR: false, // set true if you hit "Stack too deep" with complex contracts
    },
  },

  // ── Networks ────────────────────────────────────────────────────────────────
  networks: {
    // Default: in-memory Hardhat node with mock FHE
    // Fastest, no setup needed, no real encryption
    hardhat: {
      // No special config needed — @fhevm/hardhat-plugin handles mock FHE automatically
    },

    // Local persistent node (npx hardhat node in a separate terminal)
    // Mock FHE, keeps state between script calls, useful for frontend dev
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // Ethereum Sepolia — real FHE, for integration tests and demos
    sepolia: {
      url: `https://sepolia.infura.io/v3/${vars.get("INFURA_KEY", "")}`,
      chainId: 11155111,
      accounts: {
        mnemonic: vars.get("MNEMONIC", ""),
        count: 5,       // number of accounts to derive
        initialIndex: 0,
      },
      // Increase timeout for real FHE operations (can be slow)
      timeout: 120_000,
    },

    // Ethereum Mainnet — production
    // Uncomment when ready to deploy to production
    // mainnet: {
    //   url: `https://mainnet.infura.io/v3/${vars.get("INFURA_KEY", "")}`,
    //   chainId: 1,
    //   accounts: { mnemonic: vars.get("MNEMONIC", "") },
    //   timeout: 120_000,
    // },
  },

  // ── Etherscan / Block Explorer ────────────────────────────────────────────
  etherscan: {
    apiKey: {
      sepolia: vars.get("ETHERSCAN_API_KEY", ""),
      mainnet: vars.get("ETHERSCAN_API_KEY", ""),
    },
  },

  // ── TypeScript / Types ────────────────────────────────────────────────────
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },

  // ── Gas Reporter ─────────────────────────────────────────────────────────
  // Run: REPORT_GAS=true npx hardhat test
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    coinmarketcap: vars.get("CMC_API_KEY", ""),
    outputFile: "gas-report.txt",
    noColors: true,
  },

  // ── Paths ─────────────────────────────────────────────────────────────────
  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },

  // ── Mocha (test runner) ────────────────────────────────────────────────────
  mocha: {
    timeout: 180_000, // 3 minutes — real FHE tests on Sepolia need this
  },
};

export default config;
