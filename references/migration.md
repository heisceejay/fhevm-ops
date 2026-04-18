# FHEVM Migration Guide — Plain Solidity → Confidential

A step-by-step guide for converting existing Solidity contracts to use FHEVM.
Covers the most common contract types: tokens, voting, and games/state.

---

## The Migration Mindset

Standard Solidity: transparent state, revert on bad input, branch freely.
FHEVM Solidity:    encrypted state, silent-zero on bad input, branch via FHE.select.

Three things change:
1. **Types** — `uint64` → `euint64`, `bool` → `ebool`
2. **Input handling** — `uint64 amount` → `externalEuint64 enc, bytes calldata proof`
3. **Branching** — `if (x > y)` → `FHE.select(FHE.gt(x, y), trueVal, falseVal)`

---

## Step-by-Step Migration

### Step 1: Add FHEVM Imports and Inherit Config

```solidity
// BEFORE
pragma solidity ^0.8.27;

contract Token {
```

```solidity
// AFTER
pragma solidity ^0.8.27;

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract Token is ZamaEthereumConfig {  // ← inherit config FIRST
```

### Step 2: Convert State Variable Types

| Before | After |
|---|---|
| `mapping(address => uint64) balances` | `mapping(address => euint64) balances` |
| `uint64 totalSupply` | `euint64 totalSupply` (or keep plaintext if public) |
| `bool hasVoted` | `mapping(address => bool) hasVoted` (who voted stays public) |
| `bool voteValue` | `ebool voteValue` |
| `address winner` | `eaddress winner` (or keep plaintext if the identity is public) |

```solidity
// BEFORE
mapping(address => uint64) public balances;
uint64 public totalSupply;

// AFTER — private! Encrypted values should not be public state vars
mapping(address => euint64) private _balances;
euint64 private _totalSupply;

// Expose via explicit getter (returns handle, not plaintext)
function balanceOf(address account) external view returns (euint64) {
    return _balances[account];
}
```

### Step 3: Update Function Parameters

```solidity
// BEFORE — plaintext parameters
function transfer(address to, uint64 amount) external {
    require(balances[msg.sender] >= amount, "Insufficient balance");
    balances[msg.sender] -= amount;
    balances[to] += amount;
}

// AFTER — encrypted parameter with proof
function transfer(
    address to,
    externalEuint64 encAmount,  // ← type changed
    bytes calldata inputProof   // ← new param, validates ZKPoK
) external {
    euint64 amount = FHE.fromExternal(encAmount, inputProof);

    // No require() — use no-revert pattern instead
    ebool canTransfer = FHE.le(amount, _balances[msg.sender]);
    euint64 actual = FHE.select(canTransfer, amount, FHE.asEuint64(0));

    _balances[msg.sender] = FHE.sub(_balances[msg.sender], actual);
    _balances[to]         = FHE.add(_balances[to], actual);

    // REQUIRED after every encrypted state update
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);
    FHE.allowThis(_balances[to]);
    FHE.allow(_balances[to], to);
}
```

### Step 4: Replace Conditional Logic

```solidity
// BEFORE — standard if/require
function withdraw(uint64 amount) external {
    require(balances[msg.sender] >= amount, "Too low");
    balances[msg.sender] -= amount;
    payable(msg.sender).transfer(amount);
}

// AFTER — FHE.select pattern
function withdraw(externalEuint64 encAmount, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(encAmount, proof);
    ebool ok       = FHE.le(amount, _balances[msg.sender]);
    euint64 actual = FHE.select(ok, amount, FHE.asEuint64(0));

    _balances[msg.sender] = FHE.sub(_balances[msg.sender], actual);
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);

    // Note: transferring ETH requires decrypted amount — use async decrypt pattern
    // or keep withdraw amounts as plaintext and only encrypt balances
}
```

### Step 5: Add ACL Grants Everywhere

After **every assignment to an encrypted state variable**, add:
```solidity
FHE.allowThis(variable);         // contract keeps access next tx
FHE.allow(variable, userAddr);   // user can decrypt
```

### Step 6: Update Constructor

```solidity
// BEFORE
constructor() {
    totalSupply = 0;
}

// AFTER
constructor() {
    // FHE.asEuint64(0) is safe in constructor
    _totalSupply = FHE.asEuint64(0);
    FHE.allowThis(_totalSupply);
}
```

### Step 7: Update Events (Don't Leak Amounts)

```solidity
// BEFORE — leaks transfer amounts
event Transfer(address indexed from, address indexed to, uint256 amount);

// AFTER — only public metadata
event Transfer(address indexed from, address indexed to);
// Authorized parties can decrypt balances off-chain if needed
```

---

## Migration Example: Simple Token

### Before (Standard ERC-20-style)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

contract SimpleToken {
    mapping(address => uint64) public balances;

    event Transfer(address indexed from, address indexed to, uint64 amount);

    function mint(address to, uint64 amount) external {
        balances[to] += amount;
    }

    function transfer(address to, uint64 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        emit Transfer(msg.sender, to, amount);
    }
}
```

### After (FHEVM Confidential Token)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConfidentialToken is ZamaEthereumConfig {
    mapping(address => euint64) private _balances;

    // No amount in event — amounts are confidential
    event Transfer(address indexed from, address indexed to);

    function mint(address to, uint64 amount) external {
        _balances[to] = FHE.add(_balances[to], FHE.asEuint64(amount));
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);
    }

    function transfer(
        address to,
        externalEuint64 encAmount,
        bytes calldata inputProof
    ) external {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        ebool ok       = FHE.le(amount, _balances[msg.sender]);
        euint64 actual = FHE.select(ok, amount, FHE.asEuint64(0));

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], actual);
        _balances[to]         = FHE.add(_balances[to], actual);

        FHE.allowThis(_balances[msg.sender]); FHE.allow(_balances[msg.sender], msg.sender);
        FHE.allowThis(_balances[to]);         FHE.allow(_balances[to], to);

        emit Transfer(msg.sender, to);
    }

    function balanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }
}
```

---

## Migration Example: Voting Contract

### Before

```solidity
contract Voting {
    mapping(address => bool) public hasVoted;
    uint256 public yesCount;
    uint256 public noCount;

    function vote(bool isYes) external {
        require(!hasVoted[msg.sender], "Already voted");
        hasVoted[msg.sender] = true;
        if (isYes) yesCount++;
        else noCount++;
    }
}
```

### After

```solidity
import {FHE, euint64, ebool, externalEbool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConfidentialVoting is ZamaEthereumConfig {
    mapping(address => bool) public hasVoted; // who voted = public; how = private
    euint64 private _yesCount;
    euint64 private _noCount;
    address public admin;

    constructor() {
        admin = msg.sender;
        _yesCount = FHE.asEuint64(0);
        _noCount  = FHE.asEuint64(0);
        FHE.allowThis(_yesCount); FHE.allow(_yesCount, admin);
        FHE.allowThis(_noCount);  FHE.allow(_noCount,  admin);
    }

    function vote(externalEbool encVote, bytes calldata proof) external {
        require(!hasVoted[msg.sender], "Already voted");
        hasVoted[msg.sender] = true;

        ebool isYes = FHE.fromExternal(encVote, proof);

        // Both branches run; only result is applied — no if needed
        _yesCount = FHE.add(_yesCount, FHE.select(isYes, FHE.asEuint64(1), FHE.asEuint64(0)));
        _noCount  = FHE.add(_noCount,  FHE.select(isYes, FHE.asEuint64(0), FHE.asEuint64(1)));

        FHE.allowThis(_yesCount); FHE.allow(_yesCount, admin);
        FHE.allowThis(_noCount);  FHE.allow(_noCount,  admin);
    }
}
```

---

## Migration Checklist

Use this when converting any contract:

- [ ] Added `import {FHE, ...} from "@fhevm/solidity/lib/FHE.sol"`
- [ ] Added `import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol"`
- [ ] Contract inherits `ZamaEthereumConfig` as first parent
- [ ] Sensitive state variables converted from `uint64` → `euint64`
- [ ] State variables converted to `private` (encrypted state ≠ public)
- [ ] Public getters return `euint64` (handle), not `uint64` (plaintext)
- [ ] All user-input functions use `externalEuintX + inputProof` pattern
- [ ] All `FHE.fromExternal()` calls validate before using the result
- [ ] `if (x > y)` / `require(bool)` replaced with `FHE.select(ebool, ...)`
- [ ] Every encrypted state update followed by `FHE.allowThis` + `FHE.allow`
- [ ] `FHE.allowThis` called AFTER the assignment (not before)
- [ ] Events don't emit encrypted amounts
- [ ] Constructor initializes encrypted vars with `FHE.asEuintX(0)` if needed
- [ ] Tests updated to use `fhevm.createEncryptedInput` and `fhevm.userDecryptEuint`

---

## What Doesn't Need to Change

Not every field needs encryption. Apply FHE only to genuinely sensitive data:

| Keep Plaintext | Consider Encrypting |
|---|---|
| Address lookup mappings | Token balances |
| Ownership / access control | Vote choices |
| Timestamps and deadlines | Bid amounts |
| Token name, symbol, decimals | Game state (hand, score) |
| Whether a user has voted | Credit scores / risk ratings |
| Contract paused state | KYC tier without revealing tier number |

Mixing public and encrypted state in the same contract is perfectly valid and common.
