// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title BlindAuction
 * @notice Sealed-bid auction: all bids are encrypted; winner determined without
 *         revealing any individual bid amounts.
 *
 * Properties:
 * - Bids are submitted as encrypted euint64 values with ZKPoK
 * - The running highest bid and bidder are tracked in encrypted state
 * - FHE.select atomically updates leader without branching
 * - Each bidder can retrieve their own encrypted bid (for potential refunds)
 * - Beneficiary can optionally reveal winner publicly at auction end
 *
 * Extension ideas:
 * - Add ERC-7984 token payment (confidential deposit + refund)
 * - Add floor price: FHE.max(bid, encryptedFloor)
 * - Add multiple winners for batch auctions
 */

import {FHE, euint64, eaddress, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract BlindAuction is ZamaEthereumConfig {

    // ── State ────────────────────────────────────────────────────────────────

    euint64  private _highestBid;      // encrypted highest bid so far
    eaddress private _highestBidder;   // encrypted address of highest bidder

    address public  beneficiary;
    bool    public  ended;
    uint256 public  endTime;

    mapping(address => euint64) private _bids;  // each bidder's own bid

    // ── Events ───────────────────────────────────────────────────────────────

    event BidPlaced(address indexed bidder);
    event AuctionEnded(bool winnerRevealed);

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier auctionOpen() {
        require(!ended, "BlindAuction: auction ended");
        require(block.timestamp < endTime, "BlindAuction: time expired");
        _;
    }

    modifier onlyBeneficiary() {
        require(msg.sender == beneficiary, "BlindAuction: not beneficiary");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _beneficiary  Receives proceeds; can end auction and reveal winner
     * @param duration      Auction duration in seconds
     */
    constructor(address _beneficiary, uint256 duration) {
        beneficiary = _beneficiary;
        endTime     = block.timestamp + duration;
    }

    // ── Bid ──────────────────────────────────────────────────────────────────

    /**
     * @notice Submit an encrypted bid.
     * @param encBid     Encrypted bid amount (encrypted client-side via fhevmjs)
     * @param inputProof ZKPoK proving bidder knows their bid value
     *
     * @dev The comparison FHE.gt(newBid, _highestBid) runs on encrypted values.
     *      No branch is taken in plaintext — FHE.select updates both handles.
     *      A bidder can bid multiple times; only the last bid is stored.
     */
    function bid(externalEuint64 encBid, bytes calldata inputProof) external auctionOpen {
        euint64 newBid = FHE.fromExternal(encBid, inputProof);

        // Encrypted comparison — result is ebool (not a real bool)
        ebool isHigher = FHE.gt(newBid, _highestBid);

        // Atomically update leader: if newBid > _highestBid, replace both
        _highestBid    = FHE.select(isHigher, newBid,                      _highestBid);
        _highestBidder = FHE.select(isHigher, FHE.asEaddress(msg.sender), _highestBidder);

        // ACL: grant access to the updated handles
        FHE.allowThis(_highestBid);
        FHE.allowThis(_highestBidder);
        FHE.allow(_highestBid,    beneficiary);
        FHE.allow(_highestBidder, beneficiary);

        // Store bidder's own bid (for refund logic or verification)
        _bids[msg.sender] = newBid;
        FHE.allowThis(_bids[msg.sender]);
        FHE.allow(_bids[msg.sender], msg.sender);  // bidder can see their own bid

        emit BidPlaced(msg.sender);
    }

    // ── End Auction ──────────────────────────────────────────────────────────

    /**
     * @notice End the auction.
     * @param revealWinner If true, makes the winner publicly decryptable.
     *                     If false, only beneficiary can decrypt privately.
     */
    function endAuction(bool revealWinner) external onlyBeneficiary {
        require(block.timestamp >= endTime || !ended, "BlindAuction: already ended");
        ended = true;

        if (revealWinner) {
            // Anyone can decrypt winner via Gateway after this call
            FHE.makePubliclyDecryptable(_highestBid);
            FHE.makePubliclyDecryptable(_highestBidder);
        }

        emit AuctionEnded(revealWinner);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    /// @notice Beneficiary can decrypt the current leading bid (requires ACL access)
    function getHighestBid() external view returns (euint64) {
        return _highestBid;
    }

    /// @notice Beneficiary can decrypt the current leading bidder (requires ACL access)
    function getHighestBidder() external view returns (eaddress) {
        return _highestBidder;
    }

    /// @notice Each bidder can retrieve and decrypt their own bid
    function getMyBid() external view returns (euint64) {
        return _bids[msg.sender];
    }
}
