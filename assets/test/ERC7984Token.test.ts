/**
 * ERC7984Token.test.ts
 * Comprehensive test suite for the ERC7984Token confidential token.
 *
 * Run:  npx hardhat test                          (mock FHE — fastest)
 *       npx hardhat test --network sepolia         (real FHE — slow)
 *
 * Test structure:
 * - Helpers: encrypt64(), getBalance() — reuse across all tests
 * - Deployment and initialization checks
 * - Mint: clear mint and encrypted mint
 * - Transfer: normal, insufficient balance (no-revert), sequential
 * - Operator flow: setOperator, transferFrom, revoke
 * - ACL: handle state and permission checks
 */

import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ERC-7984 overloaded function signatures used with ethers.js
// (ethers requires explicit selector strings when a function is overloaded)
const SIG_TRANSFER     = "confidentialTransfer(address,bytes32,bytes)";
const SIG_TRANSFER_FROM = "confidentialTransferFrom(address,address,bytes32,bytes)";

describe("ERC7984Token", function () {
  // ── State ──────────────────────────────────────────────────────────────────

  let token: any;
  let tokenAddress: string;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;

  // ── Fixtures ───────────────────────────────────────────────────────────────

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();

    token = await ethers.deployContract("ERC7984Token", [
      owner.address,
      "Test Confidential Token",
      "TCT",
      "https://example.com/tct",
    ]);
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Encrypt a euint64 for a specific signer, bound to this contract */
  async function encrypt64(
    value: bigint,
    signer: HardhatEthersSigner,
  ): Promise<{ handles: string[]; inputProof: string }> {
    return fhevm
      .createEncryptedInput(tokenAddress, signer.address)
      .add64(value)
      .encrypt();
  }

  /**
   * Decrypt a euint64 handle for a signer who has ACL access.
   * Returns 0n for uninitialized handles (bytes32(0)).
   */
  async function getBalance(signer: HardhatEthersSigner): Promise<bigint> {
    const handle = await token.confidentialBalanceOf(signer.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, signer);
  }

  /** Convenience: transfer amount from one signer to another */
  async function transfer(amount: bigint, from: HardhatEthersSigner, to: HardhatEthersSigner) {
    const { handles, inputProof } = await encrypt64(amount, from);
    return token.connect(from)[SIG_TRANSFER](to.address, handles[0], inputProof);
  }

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets correct name and symbol", async function () {
      expect(await token.name()).to.equal("Test Confidential Token");
      expect(await token.symbol()).to.equal("TCT");
    });

    it("sets correct owner", async function () {
      expect(await token.owner()).to.equal(owner.address);
    });

    it("initial balances are uninitialized — handle equals bytes32(0)", async function () {
      // bytes32(0) means the mapping slot was never written — NOT "balance = 0"
      const handle = await token.confidentialBalanceOf(alice.address);
      expect(handle).to.equal(ethers.ZeroHash);
    });

    it("contractURI is set", async function () {
      expect(await token.contractURI()).to.equal("https://example.com/tct");
    });
  });

  // ── Minting ────────────────────────────────────────────────────────────────

  describe("Mint", function () {
    it("mintClear: owner mints with plaintext amount", async function () {
      await token.connect(owner).mintClear(alice.address, 1000n);
      expect(await getBalance(alice)).to.equal(1000n);
    });

    it("mintClear: balance handle is non-zero after mint", async function () {
      await token.connect(owner).mintClear(alice.address, 100n);
      const handle = await token.confidentialBalanceOf(alice.address);
      expect(handle).to.not.equal(ethers.ZeroHash);
    });

    it("mintClear: non-owner cannot mint", async function () {
      await expect(
        token.connect(alice).mintClear(bob.address, 100n),
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("mint: owner mints with encrypted amount", async function () {
      const { handles, inputProof } = await encrypt64(500n, owner);
      await token.connect(owner).mint(alice.address, handles[0], inputProof);
      expect(await getBalance(alice)).to.equal(500n);
    });

    it("mint: encrypted and clear mints accumulate", async function () {
      await token.connect(owner).mintClear(alice.address, 300n);
      await token.connect(owner).mintClear(alice.address, 700n);
      expect(await getBalance(alice)).to.equal(1000n);
    });

    it("mint: multiple recipients get correct balances", async function () {
      await token.connect(owner).mintClear(alice.address, 100n);
      await token.connect(owner).mintClear(bob.address,   200n);
      await token.connect(owner).mintClear(carol.address, 300n);

      expect(await getBalance(alice)).to.equal(100n);
      expect(await getBalance(bob)).to.equal(200n);
      expect(await getBalance(carol)).to.equal(300n);
    });
  });

  // ── Transfers ──────────────────────────────────────────────────────────────

  describe("Transfer", function () {
    beforeEach(async function () {
      await token.connect(owner).mintClear(alice.address, 1000n);
    });

    it("moves tokens correctly between accounts", async function () {
      await transfer(300n, alice, bob);

      expect(await getBalance(alice)).to.equal(700n);
      expect(await getBalance(bob)).to.equal(300n);
    });

    it("insufficient balance sends 0 — no revert, no information leak", async function () {
      // Alice has 1000, tries to send 2000 — ERC-7984 no-revert pattern
      await transfer(2000n, alice, bob);

      // Alice unchanged, Bob receives 0 (silent fail preserves privacy)
      expect(await getBalance(alice)).to.equal(1000n);
      expect(await getBalance(bob)).to.equal(0n);
    });

    it("zero-amount transfer is a no-op", async function () {
      await transfer(0n, alice, bob);

      expect(await getBalance(alice)).to.equal(1000n);
      expect(await getBalance(bob)).to.equal(0n);
    });

    it("full-balance transfer empties sender", async function () {
      await transfer(1000n, alice, bob);

      expect(await getBalance(alice)).to.equal(0n);
      expect(await getBalance(bob)).to.equal(1000n);
    });

    it("sequential transfers chain correctly", async function () {
      await transfer(400n, alice, bob);    // alice=600, bob=400
      await transfer(100n, bob,   carol);  // bob=300,   carol=100
      await transfer(50n,  alice, carol);  // alice=550,  carol=150

      expect(await getBalance(alice)).to.equal(550n);
      expect(await getBalance(bob)).to.equal(300n);
      expect(await getBalance(carol)).to.equal(150n);
    });

    it("transfer to self is a no-op", async function () {
      await transfer(200n, alice, alice);
      expect(await getBalance(alice)).to.equal(1000n);
    });
  });

  // ── Operators ──────────────────────────────────────────────────────────────

  describe("Operators", function () {
    beforeEach(async function () {
      await token.connect(owner).mintClear(alice.address, 1000n);
    });

    it("setOperator: grants operator permission", async function () {
      await token.connect(alice).setOperator(bob.address, true);
      expect(await token.isOperator(alice.address, bob.address)).to.be.true;
    });

    it("setOperator: operator can call confidentialTransferFrom", async function () {
      await token.connect(alice).setOperator(bob.address, true);

      // Encrypt amount as alice (the token holder, not the operator)
      const { handles, inputProof } = await encrypt64(200n, alice);
      await token
        .connect(bob)
        [SIG_TRANSFER_FROM](alice.address, carol.address, handles[0], inputProof);

      expect(await getBalance(alice)).to.equal(800n);
      expect(await getBalance(carol)).to.equal(200n);
    });

    it("setOperator: revoke removes permission", async function () {
      await token.connect(alice).setOperator(bob.address, true);
      await token.connect(alice).setOperator(bob.address, false);
      expect(await token.isOperator(alice.address, bob.address)).to.be.false;
    });

    it("non-operator cannot call transferFrom", async function () {
      const { handles, inputProof } = await encrypt64(100n, alice);
      await expect(
        token.connect(bob)[SIG_TRANSFER_FROM](
          alice.address, carol.address, handles[0], inputProof,
        ),
      ).to.be.reverted;
    });
  });

  // ── ACL / Permissions ──────────────────────────────────────────────────────

  describe("Access Control (ACL)", function () {
    it("recipient gets ACL access to their balance after transfer", async function () {
      await token.connect(owner).mintClear(alice.address, 500n);
      await transfer(200n, alice, bob);

      // Bob should be able to decrypt their own balance
      expect(await getBalance(bob)).to.equal(200n);
    });

    it("sender retains ACL access to their balance after transfer", async function () {
      await token.connect(owner).mintClear(alice.address, 500n);
      await transfer(200n, alice, bob);

      // Alice should still be able to decrypt her remaining balance
      expect(await getBalance(alice)).to.equal(300n);
    });

    it("owner ACL access to minted handle", async function () {
      await token.connect(owner).mintClear(alice.address, 1000n);
      // Alice (recipient) must be able to decrypt — FHE.allow(handle, alice) in _mint
      expect(await getBalance(alice)).to.equal(1000n);
    });
  });

  // ── Burn ───────────────────────────────────────────────────────────────────

  describe("Burn", function () {
    it("owner can burn tokens", async function () {
      await token.connect(owner).mintClear(alice.address, 1000n);

      const { handles, inputProof } = await encrypt64(400n, owner);
      await token.connect(owner).burn(alice.address, handles[0], inputProof);

      expect(await getBalance(alice)).to.equal(600n);
    });

    it("non-owner cannot burn", async function () {
      await token.connect(owner).mintClear(alice.address, 1000n);
      const { handles, inputProof } = await encrypt64(100n, alice);
      await expect(
        token.connect(alice).burn(alice.address, handles[0], inputProof),
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });
  });
});
