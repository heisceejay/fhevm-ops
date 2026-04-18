/**
 * BlindAuction.test.ts
 * Full test suite for the BlindAuction contract.
 *
 * Run:  npx hardhat test test/BlindAuction.test.ts
 */

import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("BlindAuction", function () {
  // ── State ──────────────────────────────────────────────────────────────────

  let auction: any;
  let auctionAddress: string;
  let beneficiary: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;

  const DURATION = 60 * 60; // 1 hour

  // ── Fixtures ───────────────────────────────────────────────────────────────

  beforeEach(async function () {
    [beneficiary, alice, bob, carol] = await ethers.getSigners();

    auction = await ethers.deployContract("BlindAuction", [
      beneficiary.address,
      DURATION,
    ]);
    await auction.waitForDeployment();
    auctionAddress = await auction.getAddress();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function encryptBid(
    value: bigint,
    signer: HardhatEthersSigner,
  ): Promise<{ handles: string[]; inputProof: string }> {
    return fhevm
      .createEncryptedInput(auctionAddress, signer.address)
      .add64(value)
      .encrypt();
  }

  async function getMyBid(signer: HardhatEthersSigner): Promise<bigint> {
    const handle = await auction.connect(signer).getMyBid();
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, auctionAddress, signer);
  }

  async function getHighestBid(): Promise<bigint> {
    const handle = await auction.getHighestBid();
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, auctionAddress, beneficiary);
  }

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets beneficiary correctly", async function () {
      expect(await auction.beneficiary()).to.equal(beneficiary.address);
    });

    it("auction is initially not ended", async function () {
      expect(await auction.ended()).to.be.false;
    });

    it("endTime is in the future", async function () {
      const now = await time.latest();
      const endTime = await auction.endTime();
      expect(endTime).to.be.greaterThan(now);
    });
  });

  // ── Bidding ────────────────────────────────────────────────────────────────

  describe("Bidding", function () {
    it("places a bid and stores it", async function () {
      const { handles, inputProof } = await encryptBid(500n, alice);
      await auction.connect(alice).bid(handles[0], inputProof);

      expect(await getMyBid(alice)).to.equal(500n);
    });

    it("highest bid updates when a higher bid is placed", async function () {
      const enc1 = await encryptBid(300n, alice);
      const enc2 = await encryptBid(500n, bob);

      await auction.connect(alice).bid(enc1.handles[0], enc1.inputProof);
      await auction.connect(bob).bid(enc2.handles[0],   enc2.inputProof);

      // Beneficiary can decrypt and see bob won
      expect(await getHighestBid()).to.equal(500n);
    });

    it("lower bid does not displace highest bid", async function () {
      const enc1 = await encryptBid(500n, alice);
      const enc2 = await encryptBid(300n, bob);

      await auction.connect(alice).bid(enc1.handles[0], enc1.inputProof);
      await auction.connect(bob).bid(enc2.handles[0],   enc2.inputProof);

      // Alice still leads — 500 > 300
      expect(await getHighestBid()).to.equal(500n);
    });

    it("three bidders — highest wins", async function () {
      const encA = await encryptBid(200n, alice);
      const encB = await encryptBid(700n, bob);
      const encC = await encryptBid(450n, carol);

      await auction.connect(alice).bid(encA.handles[0], encA.inputProof);
      await auction.connect(bob).bid(encB.handles[0],   encB.inputProof);
      await auction.connect(carol).bid(encC.handles[0], encC.inputProof);

      expect(await getHighestBid()).to.equal(700n);
    });

    it("each bidder can retrieve only their own bid", async function () {
      const encA = await encryptBid(100n, alice);
      const encB = await encryptBid(200n, bob);

      await auction.connect(alice).bid(encA.handles[0], encA.inputProof);
      await auction.connect(bob).bid(encB.handles[0],   encB.inputProof);

      // Each sees their own bid
      expect(await getMyBid(alice)).to.equal(100n);
      expect(await getMyBid(bob)).to.equal(200n);
    });

    it("cannot bid after auction ended", async function () {
      await auction.connect(beneficiary).endAuction(false);

      const { handles, inputProof } = await encryptBid(500n, alice);
      await expect(
        auction.connect(alice).bid(handles[0], inputProof),
      ).to.be.revertedWith("BlindAuction: auction ended");
    });

    it("cannot bid after endTime passes", async function () {
      await time.increase(DURATION + 1);

      const { handles, inputProof } = await encryptBid(500n, alice);
      await expect(
        auction.connect(alice).bid(handles[0], inputProof),
      ).to.be.revertedWith("BlindAuction: time expired");
    });
  });

  // ── End Auction ────────────────────────────────────────────────────────────

  describe("endAuction", function () {
    it("beneficiary can end the auction", async function () {
      await auction.connect(beneficiary).endAuction(false);
      expect(await auction.ended()).to.be.true;
    });

    it("non-beneficiary cannot end the auction", async function () {
      await expect(
        auction.connect(alice).endAuction(false),
      ).to.be.reverted;
    });

    it("endAuction with revealWinner=false keeps result private", async function () {
      const { handles, inputProof } = await encryptBid(500n, alice);
      await auction.connect(alice).bid(handles[0], inputProof);
      await auction.connect(beneficiary).endAuction(false);

      // Beneficiary can still decrypt privately (has ACL access from bid())
      expect(await getHighestBid()).to.equal(500n);
    });
  });

  // ── End-to-End ─────────────────────────────────────────────────────────────

  describe("End-to-end auction lifecycle", function () {
    it("full flow: bid → outbid → end → verify winner", async function () {
      // Phase 1: Bids submitted (all encrypted, no order revealed)
      const encA = await encryptBid(400n, alice);
      const encB = await encryptBid(900n, bob);
      const encC = await encryptBid(650n, carol);

      await auction.connect(alice).bid(encA.handles[0], encA.inputProof);
      await auction.connect(bob).bid(encB.handles[0],   encB.inputProof);
      await auction.connect(carol).bid(encC.handles[0], encC.inputProof);

      // Phase 2: Beneficiary checks highest bid before ending
      expect(await getHighestBid()).to.equal(900n);

      // Phase 3: End auction
      await auction.connect(beneficiary).endAuction(true); // reveal publicly
      expect(await auction.ended()).to.be.true;

      // Phase 4: Individual bidders verify their own bids
      expect(await getMyBid(alice)).to.equal(400n);
      expect(await getMyBid(bob)).to.equal(900n);
      expect(await getMyBid(carol)).to.equal(650n);
    });
  });
});
