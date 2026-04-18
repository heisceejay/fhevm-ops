// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title WrappedToken
 * @notice Wraps an existing ERC-20 token (e.g. USDC, DAI) into a confidential
 *         ERC-7984 token at a 1:1 rate.
 *
 * Flow:
 *   Wrap:   User calls underlyingToken.approve(wrappedAddress, amount)
 *           then wrappedToken.wrap(userAddress, amount)
 *           → USDC moves in, cUSDC is minted (encrypted)
 *
 *   Unwrap: User calls wrappedToken.unwrap(encryptedAmount, inputProof)
 *           → cUSDC burned, USDC returned
 *           Note: unwrap is async — goes through the Gateway
 *
 * Key properties:
 * - The underlying ERC-20 is held by this contract
 * - Balances of the wrapped token are fully encrypted (euint64)
 * - The total ERC-20 supply locked ≡ total cToken minted (verifiable on-chain)
 * - Uses OpenZeppelin's ERC7984ERC20Wrapper for the core logic
 *
 * Deployment:
 *   WrappedToken(IERC20 underlyingTokenAddress)
 *   e.g. WrappedToken(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48) for mainnet USDC
 */

import {ERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract WrappedToken is ZamaEthereumConfig, ERC7984ERC20Wrapper, Ownable2Step {
    using SafeERC20 for IERC20;

    // Emitted on wrap/unwrap — amounts NOT included (confidential)
    event Wrapped(address indexed account);
    event Unwrapped(address indexed account);

    /**
     * @param underlying  The ERC-20 token address to wrap
     * @param name_       Name for the wrapped token (e.g. "Confidential USDC")
     * @param symbol_     Symbol for the wrapped token (e.g. "cUSDC")
     * @param owner_      Initial owner (can pause/configure)
     */
    constructor(
        IERC20 underlying,
        string memory name_,
        string memory symbol_,
        string memory contractURI_,
        address owner_
    )
        ERC7984ERC20Wrapper(
            underlying,
            1  // 1:1 exchange rate (1 underlying unit = 1 wrapped unit)
        )
        ERC7984(name_, symbol_, contractURI_)
        Ownable(owner_)
    {}

    // ── Wrap / Unwrap ─────────────────────────────────────────────────────────
    //
    // Both are inherited from ERC7984ERC20Wrapper. Provided here for documentation:
    //
    // function wrap(address account, uint256 amount) external
    //   Requires: underlying.approve(address(this), amount) called first
    //   Transfers `amount` of underlying token from msg.sender to this contract
    //   Mints `amount` of wrapped token (encrypted) to `account`
    //   Emits: Wrapped(account)
    //
    // function unwrap(externalEuint64 encryptedAmount, bytes calldata inputProof) external
    //   Burns `encryptedAmount` of wrapped token from msg.sender
    //   Releases equivalent underlying tokens back to msg.sender
    //   Note: Unwrap is async — result arrives via Gateway callback
    //   Emits: Unwrapped(msg.sender)
    //
    // function underlyingToken() external view returns (IERC20)
    // function exchangeRate() external view returns (uint256)   // always 1

    // ── Emergency ─────────────────────────────────────────────────────────────

    /**
     * @notice Emergency recovery of stuck non-underlying tokens.
     * @dev Cannot be used to drain the underlying token.
     */
    function recoverToken(IERC20 token, address to, uint256 amount) external onlyOwner {
        require(address(token) != address(underlying()), "WrappedToken: cannot drain underlying");
        token.safeTransfer(to, amount);
    }

    /**
     * @notice Returns the address of the underlying ERC-20 token.
     */
    function underlyingAddress() external view returns (address) {
        return address(underlying());
    }
}
