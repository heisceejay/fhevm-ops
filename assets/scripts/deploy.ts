/**
 * deploy.ts — Generic FHEVM contract deployment script
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts                    # Hardhat local (mock)
 *   npx hardhat run scripts/deploy.ts --network sepolia  # Ethereum Sepolia (real FHE)
 *   npx hardhat run scripts/deploy.ts --network mainnet  # Ethereum mainnet
 *
 * After deployment on a real network, verify FHEVM compatibility:
 *   npx hardhat fhevm check-fhevm-compatibility --network sepolia --address <addr>
 *
 * ─── IMPORTANT: Customizing for your contract ────────────────────────────────
 *
 * Every FHEVM contract has unique constructor arguments. You MUST update:
 *   1. CONTRACT_NAME — the Solidity contract name
 *   2. constructorArgs — the array of arguments passed to deploy()
 *
 * Common FHEVM constructor patterns:
 *
 *   ERC7984Token:
 *     const constructorArgs = [deployer.address, "Token Name", "SYM", "https://..."];
 *
 *   ConfidentialVoting:
 *     const deadline = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
 *     const constructorArgs = ["Should we upgrade?", deadline];
 *
 *   BlindAuction:
 *     const endTime = Math.floor(Date.now() / 1000) + (3 * 24 * 60 * 60);
 *     const constructorArgs = [deployer.address, endTime];
 *
 * If your contract's constructor calls FHE.asEuint64() or similar to initialize
 * encrypted state, the deployment MUST happen on a network with a working FHE
 * coprocessor (Sepolia/Mainnet) or via `hardhat test` (which uses the mock).
 * Running `hardhat run` against the in-memory Hardhat network will revert because
 * the mock coprocessor is only wired up during the test runner.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ══════════════════════════════════════════════════════════════════════════════
// ██  EDIT THESE FOR YOUR CONTRACT
// ══════════════════════════════════════════════════════════════════════════════

const CONTRACT_NAME = "ERC7984Token"; // ← Change to your contract name

/**
 * Build the constructor arguments for your contract.
 * This function receives the deployer signer so you can use its address.
 */
async function buildConstructorArgs(deployer: any): Promise<any[]> {
  // ── ERC7984Token example ────────────────────────────────────────────────
  const TOKEN_NAME    = process.env.TOKEN_NAME    ?? "My Confidential Token";
  const TOKEN_SYMBOL  = process.env.TOKEN_SYMBOL  ?? "MCT";
  const TOKEN_URI     = process.env.TOKEN_URI     ?? "https://example.com/mct";
  const INITIAL_OWNER = process.env.INITIAL_OWNER ?? deployer.address;

  return [INITIAL_OWNER, TOKEN_NAME, TOKEN_SYMBOL, TOKEN_URI];

  // ── ConfidentialVoting example (uncomment and replace the above) ────────
  // const QUESTION = process.env.QUESTION ?? "Should we upgrade the protocol?";
  // const DURATION_DAYS = parseInt(process.env.DURATION_DAYS ?? "7", 10);
  // const deadline = Math.floor(Date.now() / 1000) + (DURATION_DAYS * 24 * 60 * 60);
  // return [QUESTION, deadline];

  // ── BlindAuction example (uncomment and replace the above) ─────────────
  // const DURATION_DAYS = parseInt(process.env.DURATION_DAYS ?? "3", 10);
  // const endTime = Math.floor(Date.now() / 1000) + (DURATION_DAYS * 24 * 60 * 60);
  // return [deployer.address, endTime];
}

// ══════════════════════════════════════════════════════════════════════════════

interface DeploymentResult {
  contractName: string;
  address: string;
  deployer: string;
  network: string;
  blockNumber: number;
  txHash: string;
  constructorArgs: any[];
  timestamp: string;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(60));
  console.log(`FHEVM Deployment: ${CONTRACT_NAME}`);
  console.log("=".repeat(60));
  console.log(`Network:    ${network.name}`);
  console.log(`Deployer:   ${deployer.address}`);
  console.log(`Balance:    ${ethers.formatEther(balance)} ETH`);
  console.log("");

  if (balance === 0n && network.name !== "hardhat") {
    throw new Error("Deployer has no ETH — fund the wallet first");
  }

  // ── Build args & deploy ────────────────────────────────────────────────────

  const constructorArgs = await buildConstructorArgs(deployer);

  console.log(`Deploying ${CONTRACT_NAME}...`);
  console.log(`  Constructor args: ${JSON.stringify(constructorArgs)}`);
  console.log("");

  const Factory = await ethers.getContractFactory(CONTRACT_NAME);
  const contract = await Factory.deploy(...constructorArgs);

  console.log("Waiting for deployment confirmation...");
  await contract.waitForDeployment();

  const address     = await contract.getAddress();
  const deployTx    = contract.deploymentTransaction();
  const receipt     = await deployTx?.wait(1);
  const blockNumber = receipt?.blockNumber ?? 0;

  console.log("");
  console.log("✅ Deployment successful!");
  console.log(`  Address:     ${address}`);
  console.log(`  Tx hash:     ${deployTx?.hash ?? "N/A"}`);
  console.log(`  Block:       ${blockNumber}`);
  console.log("");

  // ── Save deployment info ────────────────────────────────────────────────────

  const result: DeploymentResult = {
    contractName: CONTRACT_NAME,
    address,
    deployer: deployer.address,
    network: network.name,
    blockNumber,
    txHash: deployTx?.hash ?? "",
    constructorArgs,
    timestamp: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outFile = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`📄 Deployment saved to: ${outFile}`);

  // ── Next steps ──────────────────────────────────────────────────────────────

  console.log("");
  console.log("Next steps:");
  if (network.name === "sepolia" || network.name === "mainnet") {
    console.log(`  1. Verify FHEVM compatibility:`);
    console.log(`     npx hardhat fhevm check-fhevm-compatibility \\`);
    console.log(`       --network ${network.name} \\`);
    console.log(`       --address ${address}`);
  } else {
    console.log("  Running on local network — deploy to Sepolia for real FHE.");
  }

  return result;
}

main()
  .then((result) => {
    console.log("\nDeployment complete:", result.address);
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
