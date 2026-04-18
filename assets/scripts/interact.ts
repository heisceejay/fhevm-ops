/**
 * interact.ts — Interact with a deployed ERC7984Token
 *
 * Demonstrates the full lifecycle from a Node.js/Hardhat script:
 *   1. Connect to a deployed contract
 *   2. Mint tokens (cleartext amount, trusted admin)
 *   3. Encrypt an amount and transfer
 *   4. Decrypt the recipient's balance (user decryption, EIP-712)
 *
 * Usage:
 *   # Run against local node (start with: npx hardhat node)
 *   npx hardhat run scripts/interact.ts --network localhost
 *
 *   # Run against Sepolia
 *   npx hardhat run scripts/interact.ts --network sepolia
 *
 * Requires: CONTRACT_ADDRESS env variable (or update the address below)
 */

import { ethers, fhevm, network } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

// ── Config ────────────────────────────────────────────────────────────────────

// Set this to your deployed contract address, or export CONTRACT_ADDRESS env var
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS ?? "";

// Minimal ABI for interacting with ERC7984Token
const ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "function mintClear(address to, uint64 amount) external",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function confidentialTransfer(address to, bytes32 encAmount, bytes calldata proof) external returns (bool)",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

async function encryptAmount(
  contractAddress: string,
  userAddress: string,
  amount: bigint,
): Promise<{ handle: string; inputProof: string }> {
  const { handles, inputProof } = await fhevm
    .createEncryptedInput(contractAddress, userAddress)
    .add64(amount)
    .encrypt();
  return { handle: handles[0], inputProof };
}

async function decryptBalance(
  contractAddress: string,
  userAddress: string,
  signer: any,
): Promise<bigint> {
  const contract = await ethers.getContractAt(ABI, contractAddress);
  const handle   = await contract.confidentialBalanceOf(userAddress);

  if (handle === ethers.ZeroHash) {
    console.log(`  Balance handle: uninitialized (bytes32(0))`);
    return 0n;
  }

  const balance = await fhevm.userDecryptEuint(
    FhevmType.euint64,
    handle,
    contractAddress,
    signer,
  );
  return balance;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!CONTRACT_ADDRESS) {
    throw new Error(
      "CONTRACT_ADDRESS not set.\n" +
      "Either deploy first: npx hardhat run scripts/deploy.ts\n" +
      "Or export CONTRACT_ADDRESS=0x... before running this script."
    );
  }

  const [owner, alice, bob] = await ethers.getSigners();
  const contract = await ethers.getContractAt(ABI, CONTRACT_ADDRESS);

  console.log("=".repeat(60));
  console.log("FHEVM Token Interaction Demo");
  console.log("=".repeat(60));
  console.log(`Network:   ${network.name}`);
  console.log(`Contract:  ${CONTRACT_ADDRESS}`);
  console.log(`Owner:     ${owner.address}`);
  console.log(`Alice:     ${alice.address}`);
  console.log(`Bob:       ${bob.address}`);
  console.log("");

  // ── Step 1: Check contract info ────────────────────────────────────────────

  console.log("── Contract Info ──");
  console.log(`Name:   ${await contract.name()}`);
  console.log(`Symbol: ${await contract.symbol()}`);
  console.log("");

  // ── Step 2: Mint to Alice ──────────────────────────────────────────────────

  console.log("── Minting 1000 tokens to Alice ──");
  const mintTx = await contract.connect(owner).mintClear(alice.address, 1000n);
  await mintTx.wait();
  console.log(`  Tx: ${mintTx.hash}`);

  const aliceBalanceAfterMint = await decryptBalance(CONTRACT_ADDRESS, alice.address, alice);
  console.log(`  Alice balance: ${aliceBalanceAfterMint}`);
  console.log("");

  // ── Step 3: Encrypt and Transfer ──────────────────────────────────────────

  console.log("── Transferring 300 tokens: Alice → Bob ──");
  const { handle, inputProof } = await encryptAmount(
    CONTRACT_ADDRESS,
    alice.address,
    300n,
  );
  console.log(`  Encrypted handle: ${handle.slice(0, 18)}...`);

  const transferTx = await contract
    .connect(alice)
    ["confidentialTransfer(address,bytes32,bytes)"](bob.address, handle, inputProof);
  await transferTx.wait();
  console.log(`  Tx: ${transferTx.hash}`);
  console.log("");

  // ── Step 4: Decrypt Both Balances ─────────────────────────────────────────

  console.log("── Decrypting Balances ──");
  const aliceFinal = await decryptBalance(CONTRACT_ADDRESS, alice.address, alice);
  const bobFinal   = await decryptBalance(CONTRACT_ADDRESS, bob.address,   bob);

  console.log(`  Alice: ${aliceFinal} (expected 700)`);
  console.log(`  Bob:   ${bobFinal}   (expected 300)`);
  console.log("");

  // ── Step 5: Verify ────────────────────────────────────────────────────────

  const pass = aliceFinal === 700n && bobFinal === 300n;
  console.log(`── Verification: ${pass ? "✅ PASSED" : "❌ FAILED"} ──`);
  if (!pass) {
    throw new Error(`Unexpected balances: alice=${aliceFinal}, bob=${bobFinal}`);
  }
}

main().catch((e) => {
  console.error("\n❌ Script failed:", e);
  process.exit(1);
});
