/**
 * ConfidentialVoting.test.ts
 * Full test suite for the ConfidentialVoting contract.
 *
 * Run:  npx hardhat test test/ConfidentialVoting.test.ts
 */

import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("ConfidentialVoting", function () {
  // ── State ──────────────────────────────────────────────────────────────────

  let voting: any;
  let votingAddress: string;
  let admin: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;

  const DEADLINE_DELTA = 60 * 60 * 24; // 24 hours in seconds

  // ── Fixtures ───────────────────────────────────────────────────────────────

  async function deployVoting() {
    const now = await time.latest();
    voting = await ethers.deployContract("ConfidentialVoting", [
      "Should we upgrade the protocol?",
      now + DEADLINE_DELTA,
    ]);
    await voting.waitForDeployment();
    votingAddress = await voting.getAddress();
  }

  beforeEach(async function () {
    [admin, alice, bob, carol] = await ethers.getSigners();
    await deployVoting();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Encrypt a vote: true = yes, false = no */
  async function encryptVote(
    value: boolean,
    signer: HardhatEthersSigner,
  ): Promise<{ handles: string[]; inputProof: string }> {
    return fhevm
      .createEncryptedInput(votingAddress, signer.address)
      .addBool(value)
      .encrypt();
  }

  /** Decrypt a euint64 tally handle (requires ACL access) */
  async function decryptTally(
    handle: string,
    signer: HardhatEthersSigner,
  ): Promise<bigint> {
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, votingAddress, signer);
  }

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets admin correctly", async function () {
      expect(await voting.admin()).to.equal(admin.address);
    });

    it("voting is initially Open", async function () {
      expect(await voting.status()).to.equal(0); // Status.Open = 0
    });

    it("question is stored", async function () {
      expect(await voting.question()).to.equal("Should we upgrade the protocol?");
    });

    it("tallies are initialized", async function () {
      // Initialized in constructor with FHE.asEuint64(0) — not bytes32(0)
      const yesHandle = await voting.getYesTally();
      const noHandle  = await voting.getNoTally();
      expect(yesHandle).to.not.equal(ethers.ZeroHash);
      expect(noHandle).to.not.equal(ethers.ZeroHash);
    });
  });

  // ── Voting ─────────────────────────────────────────────────────────────────

  describe("castVote", function () {
    it("records that a voter has voted", async function () {
      expect(await voting.hasVoted(alice.address)).to.be.false;

      const { handles, inputProof } = await encryptVote(true, alice);
      await voting.connect(alice).castVote(handles[0], inputProof);

      expect(await voting.hasVoted(alice.address)).to.be.true;
    });

    it("yes vote increments yes tally", async function () {
      const { handles, inputProof } = await encryptVote(true, alice);
      await voting.connect(alice).castVote(handles[0], inputProof);

      const yesTally = await decryptTally(await voting.getYesTally(), admin);
      const noTally  = await decryptTally(await voting.getNoTally(),  admin);

      expect(yesTally).to.equal(1n);
      expect(noTally).to.equal(0n);
    });

    it("no vote increments no tally", async function () {
      const { handles, inputProof } = await encryptVote(false, alice);
      await voting.connect(alice).castVote(handles[0], inputProof);

      const yesTally = await decryptTally(await voting.getYesTally(), admin);
      const noTally  = await decryptTally(await voting.getNoTally(),  admin);

      expect(yesTally).to.equal(0n);
      expect(noTally).to.equal(1n);
    });

    it("multiple votes accumulate correctly", async function () {
      // alice=yes, bob=yes, carol=no
      const encAlice = await encryptVote(true,  alice);
      const encBob   = await encryptVote(true,  bob);
      const encCarol = await encryptVote(false, carol);

      await voting.connect(alice).castVote(encAlice.handles[0], encAlice.inputProof);
      await voting.connect(bob).castVote(encBob.handles[0],     encBob.inputProof);
      await voting.connect(carol).castVote(encCarol.handles[0], encCarol.inputProof);

      const yesTally = await decryptTally(await voting.getYesTally(), admin);
      const noTally  = await decryptTally(await voting.getNoTally(),  admin);

      expect(yesTally).to.equal(2n);
      expect(noTally).to.equal(1n);
    });

    it("cannot vote twice", async function () {
      const { handles, inputProof } = await encryptVote(true, alice);
      await voting.connect(alice).castVote(handles[0], inputProof);

      const { handles: h2, inputProof: p2 } = await encryptVote(false, alice);
      await expect(
        voting.connect(alice).castVote(h2[0], p2),
      ).to.be.revertedWith("ConfidentialVoting: already voted");
    });

    it("cannot vote after deadline", async function () {
      await time.increase(DEADLINE_DELTA + 1); // advance past deadline

      const { handles, inputProof } = await encryptVote(true, alice);
      await expect(
        voting.connect(alice).castVote(handles[0], inputProof),
      ).to.be.revertedWith("ConfidentialVoting: deadline passed");
    });

    it("cannot vote after closeVoting", async function () {
      await voting.connect(admin).closeVoting();

      const { handles, inputProof } = await encryptVote(true, alice);
      await expect(
        voting.connect(alice).castVote(handles[0], inputProof),
      ).to.be.revertedWith("ConfidentialVoting: not open");
    });
  });

  // ── Admin ──────────────────────────────────────────────────────────────────

  describe("Admin functions", function () {
    it("admin can close voting", async function () {
      await voting.connect(admin).closeVoting();
      expect(await voting.status()).to.equal(1); // Status.Closed = 1
    });

    it("non-admin cannot close voting", async function () {
      await expect(
        voting.connect(alice).closeVoting(),
      ).to.be.revertedWith("ConfidentialVoting: not admin");
    });

    it("admin can publish results after closing", async function () {
      await voting.connect(admin).closeVoting();
      await voting.connect(admin).publishResults();
      expect(await voting.status()).to.equal(2); // Status.Revealed = 2
    });

    it("non-admin cannot publish results", async function () {
      await voting.connect(admin).closeVoting();
      await expect(
        voting.connect(alice).publishResults(),
      ).to.be.revertedWith("ConfidentialVoting: not admin");
    });

    it("cannot publish results while voting is still open", async function () {
      await expect(
        voting.connect(admin).publishResults(),
      ).to.be.revertedWith("ConfidentialVoting: voting still open");
    });
  });

  // ── End-to-End ─────────────────────────────────────────────────────────────

  describe("End-to-end: vote → close → publish → verify", function () {
    it("full voting lifecycle", async function () {
      // Phase 1: Voting
      const votes = [
        { voter: alice, isYes: true  },
        { voter: bob,   isYes: true  },
        { voter: carol, isYes: false },
      ];

      for (const { voter, isYes } of votes) {
        const { handles, inputProof } = await encryptVote(isYes, voter);
        await voting.connect(voter).castVote(handles[0], inputProof);
      }

      // Phase 2: Close
      await voting.connect(admin).closeVoting();
      expect(await voting.status()).to.equal(1);

      // Phase 3: Admin decrypts privately before publishing (admin has ACL access)
      const preYes = await decryptTally(await voting.getYesTally(), admin);
      const preNo  = await decryptTally(await voting.getNoTally(),  admin);
      expect(preYes).to.equal(2n);
      expect(preNo).to.equal(1n);

      // Phase 4: Publish (make publicly decryptable)
      await voting.connect(admin).publishResults();
      expect(await voting.status()).to.equal(2);
      // After publishResults(), anyone can decrypt via instance.publicDecrypt() off-chain
    });
  });
});
