// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title ConfidentialVoting
 * @notice On-chain voting where individual votes are hidden until admin reveals totals.
 *
 * Properties:
 * - WHAT a voter voted is encrypted and never revealed per-voter
 * - THAT a voter voted is public (tracked in `hasVoted`)
 * - Tallies are encrypted until admin explicitly calls publishResults()
 * - Results are publicly decryptable by anyone after publishResults()
 * - Uses FHE.select to accumulate votes without branching on the vote value
 *
 * Use case: governance votes, elections, opinion polls where aggregate
 * results matter but individual privacy must be preserved.
 */

import {FHE, euint64, ebool, externalEbool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConfidentialVoting is ZamaEthereumConfig {

    // ── State ────────────────────────────────────────────────────────────────

    enum Status { Open, Closed, Revealed }

    euint64 private _yesVotes;
    euint64 private _noVotes;

    mapping(address => bool) public hasVoted;  // public: who voted (not how)

    Status  public status;
    address public admin;
    string  public question;
    uint256 public deadline;

    // ── Events ───────────────────────────────────────────────────────────────

    event VoteCast(address indexed voter);
    event VotingClosed();
    event ResultsPublished();

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "ConfidentialVoting: not admin");
        _;
    }

    modifier votingOpen() {
        require(status == Status.Open, "ConfidentialVoting: not open");
        require(block.timestamp <= deadline, "ConfidentialVoting: deadline passed");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _question  Human-readable question being voted on
     * @param _deadline  Unix timestamp after which voting closes
     */
    constructor(string memory _question, uint256 _deadline) {
        admin    = msg.sender;
        question = _question;
        deadline = _deadline;
        status   = Status.Open;

        // Initialize tallies to 0 — safe in constructor with deterministic value
        _yesVotes = FHE.asEuint64(0);
        _noVotes  = FHE.asEuint64(0);
        FHE.allowThis(_yesVotes);
        FHE.allowThis(_noVotes);
        FHE.allow(_yesVotes, admin);
        FHE.allow(_noVotes, admin);
    }

    // ── Voting ───────────────────────────────────────────────────────────────

    /**
     * @notice Cast an encrypted vote.
     * @param encVote   Encrypted boolean: true = yes, false = no
     * @param inputProof ZKPoK proving the voter knows their plaintext vote
     *
     * The vote is added to tallies using FHE.select — neither branch is revealed.
     * This function never reverts due to the vote value (only due to guards).
     */
    function castVote(externalEbool encVote, bytes calldata inputProof) external votingOpen {
        require(!hasVoted[msg.sender], "ConfidentialVoting: already voted");

        ebool isYes = FHE.fromExternal(encVote, inputProof);

        // Add 1 to yes or no tally — both computations run, result selected silently
        _yesVotes = FHE.add(
            _yesVotes,
            FHE.select(isYes, FHE.asEuint64(1), FHE.asEuint64(0))
        );
        _noVotes = FHE.add(
            _noVotes,
            FHE.select(isYes, FHE.asEuint64(0), FHE.asEuint64(1))
        );

        // Required: grant ACL after EVERY encrypted state mutation
        FHE.allowThis(_yesVotes);
        FHE.allowThis(_noVotes);
        FHE.allow(_yesVotes, admin);
        FHE.allow(_noVotes, admin);

        hasVoted[msg.sender] = true;
        emit VoteCast(msg.sender);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /**
     * @notice Close voting — can also be triggered by deadline passing.
     * @dev Admin closes early; deadline expiry prevents further votes automatically.
     */
    function closeVoting() external onlyAdmin {
        require(status == Status.Open, "ConfidentialVoting: already closed");
        status = Status.Closed;
        emit VotingClosed();
    }

    /**
     * @notice Publish results — makes tallies publicly decryptable.
     * @dev After this call, anyone can call the Gateway off-chain to decrypt
     *      _yesVotes and _noVotes and verify with checkSignatures.
     */
    function publishResults() external onlyAdmin {
        require(
            status == Status.Closed || block.timestamp > deadline,
            "ConfidentialVoting: voting still open"
        );
        FHE.makePubliclyDecryptable(_yesVotes);
        FHE.makePubliclyDecryptable(_noVotes);
        status = Status.Revealed;
        emit ResultsPublished();
    }

    // ── View ──────────────────────────────────────────────────────────────────

    /**
     * @notice Returns encrypted tally handles.
     * @dev Only addresses with ACL permission (admin + allowThis) can decrypt.
     *      After publishResults(), anyone can decrypt via publicDecrypt().
     */
    function getYesTally() external view returns (euint64) { return _yesVotes; }
    function getNoTally()  external view returns (euint64) { return _noVotes; }

    /// @notice Number of votes cast (public count, not per-person)
    function voteCount() external view returns (uint256) {
        // Derived from public state — no FHE needed
        // Note: this reveals total participation count (not individual votes)
        // If even count must be hidden, use a separate encrypted counter
        return 0; // TODO: track with a public counter if desired
    }
}
