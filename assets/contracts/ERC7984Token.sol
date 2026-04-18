// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title ERC7984Token
 * @notice Production-grade confidential token using OpenZeppelin ERC-7984 standard.
 *
 * Key properties:
 * - All balances are encrypted as euint64 ciphertext handles
 * - Transfer amounts are never revealed on-chain
 * - The "no-revert" pattern is used: insufficient balance = 0 transferred (no revert)
 * - Operators: ERC-7984 uses boolean operators (not encrypted allowances)
 * - Wrapping: use ERC7984ERC20Wrapper for ERC-20 ↔ ERC-7984 conversion
 *
 * @dev Inherits full IERC7984 interface:
 *   - confidentialBalanceOf(address) → euint64
 *   - confidentialTransfer(to, externalEuint64, bytes) → bool
 *   - confidentialTransferFrom(from, to, externalEuint64, bytes) → bool
 *   - confidentialTransfer(to, euint64) → bool  (existing handle)
 *   - setOperator(address, bool)
 *   - isOperator(address, address) → bool
 */

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract ERC7984Token is ZamaEthereumConfig, ERC7984, Ownable2Step {

    // ── Events ───────────────────────────────────────────────────────────────

    // Note: DO NOT emit encrypted amounts in events — they reveal metadata
    event TokensMinted(address indexed to);
    event TokensBurned(address indexed from);

    // ── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param initialOwner  Address that receives owner role
     * @param name_         Token name (e.g. "Confidential USDC")
     * @param symbol_       Token symbol (e.g. "cUSDC")
     * @param contractURI_  ERC-7572 metadata URI
     */
    constructor(
        address initialOwner,
        string memory name_,
        string memory symbol_,
        string memory contractURI_
    )
        ERC7984(name_, symbol_, contractURI_)
        Ownable(initialOwner)
    {}

    // ── Mint ─────────────────────────────────────────────────────────────────

    /**
     * @notice Mint tokens with a user-encrypted amount.
     * @dev Use for fully private initial distribution. The owner never sees the amount.
     * @param to          Recipient address
     * @param encAmount   Encrypted amount (created client-side via fhevmjs)
     * @param inputProof  ZKPoK validating the encrypted input
     */
    function mint(
        address to,
        externalEuint64 encAmount,
        bytes calldata inputProof
    ) external onlyOwner {
        _mint(to, FHE.fromExternal(encAmount, inputProof));
        emit TokensMinted(to);
    }

    /**
     * @notice Mint tokens with a known plaintext amount.
     * @dev Use ONLY for initial supply or trusted admin operations.
     *      Prefer mint() with encrypted amounts for full privacy.
     */
    function mintClear(address to, uint64 amount) external onlyOwner {
        _mint(to, FHE.asEuint64(amount));
        emit TokensMinted(to);
    }

    // ── Burn ─────────────────────────────────────────────────────────────────

    /**
     * @notice Burn tokens with an encrypted amount.
     */
    function burn(
        address from,
        externalEuint64 encAmount,
        bytes calldata inputProof
    ) external onlyOwner {
        _burn(from, FHE.fromExternal(encAmount, inputProof));
        emit TokensBurned(from);
    }

    // ── Inherited from ERC7984 (no override needed) ──────────────────────────
    //
    // function confidentialBalanceOf(address account) external view returns (euint64)
    //   Returns the encrypted handle for account's balance.
    //   Caller must have ACL permission to decrypt (granted by FHE.allow).
    //
    // function confidentialTotalSupply() external view returns (euint64)
    //
    // function confidentialTransfer(
    //     address to,
    //     externalEuint64 encAmount,
    //     bytes calldata inputProof
    // ) external returns (bool)
    //   Silent-zero pattern: if insufficient balance, 0 is transferred (no revert).
    //
    // function confidentialTransfer(address to, euint64 amount) external returns (bool)
    //   Transfer using an existing handle (must have ACL access to `amount`).
    //
    // function confidentialTransferFrom(
    //     address from,
    //     address to,
    //     externalEuint64 encAmount,
    //     bytes calldata inputProof
    // ) external returns (bool)
    //   Requires msg.sender to be an approved operator for `from`.
    //
    // function setOperator(address operator, bool approved) external
    //   Approve/revoke operator (like ERC-20 approve, but binary not amount-based).
    //
    // function isOperator(address holder, address spender) external view returns (bool)
    //
    // function name() external view returns (string memory)
    // function symbol() external view returns (string memory)
    // function decimals() external view returns (uint8)   // recommended: 6
    // function contractURI() external view returns (string memory)
}
