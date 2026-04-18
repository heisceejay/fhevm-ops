---
name: fhevm-ops
description: >
  Use this skill for ANY task involving Zama FHEVM or confidential smart contracts.
  Triggers: "confidential contract", "FHEVM", "FHE", "encrypted token", "euint",
  "ebool", "eaddress", "ERC-7984", "private voting", "blind auction", "FHE.allow",
  "fhevmjs", "Zama Protocol", "homomorphic", "ZKPoK", "input proof", "confidential
  ERC-20". Covers the full stack: writing contracts, testing, deploying, and
  frontend integration. Use this skill even when the user only asks a quick question
  about FHE types or operations — the reference files have the answers.
license: MIT. LICENSE.txt has complete terms.
metadata:
  version: "1.0.0"
  solidity: "^0.8.27"
  fhevm: "v0.11.x"
  sources:
    - https://docs.zama.org/protocol/solidity-guides
    - https://docs.openzeppelin.com/confidential-contracts
    - https://github.com/heisceejay/fhevm-ops
---

# FHEVM — Confidential Smart Contracts

Read this file fully before writing any FHEVM code. FHEVM has silent failure modes
that compile fine and break at runtime. The rules here are non-negotiable.

For deep reference, load from `references/` as needed (pointers throughout this file).

---

## Mental Model

### Symbolic Execution — the most important concept

```
Your Solidity:  euint64 result = FHE.add(a, b);
On-chain:       emits an event, stores a new bytes32 handle
Off-chain:      Zama coprocessors compute the actual FHE addition
```

**FHE operations never run cryptography on-chain.** They emit events; coprocessors
do the math; a handle (`bytes32`) is returned and stored. This means:

- All encrypted state variables are `bytes32` handles — not ciphertexts
- A freshly declared `euint64` is `bytes32(0)` — **uninitialized**, not the number zero
- Gas costs are low (symbolic only); actual compute is off-chain

### The two networks

| Network | Real FHE? | Use for |
|---|---|---|
| Hardhat (in-memory) | ❌ Mock | Dev, CI, fast iteration |
| Ethereum Sepolia / Mainnet | ✅ Real | Integration tests, production |

---

## The Five Rules (Never Break These)

**1. Always inherit `ZamaEthereumConfig` first.**
```solidity
contract Foo is ZamaEthereumConfig { ... }   // ✅
contract Foo { ... }                          // ❌ all FHE ops silently break
```

**2. Always validate user input with `FHE.fromExternal()`.**
```solidity
// ✅ validates ZKPoK — binds to this contract + msg.sender
euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
// ❌ raw handle — anyone can pass arbitrary bytes32
function deposit(euint64 amount) external { ... }
```

**3. Always call `FHE.allowThis()` + `FHE.allow()` AFTER every state update.**
```solidity
_balances[msg.sender] = FHE.add(_balances[msg.sender], amount); // new handle created
FHE.allowThis(_balances[msg.sender]);          // ← AFTER. Contract keeps access.
FHE.allow(_balances[msg.sender], msg.sender);  // ← AFTER. User can decrypt.
// Calling allowThis BEFORE the assignment grants permission to the OLD handle — a bug.
```

**4. Never branch on `ebool`. Use `FHE.select()` instead.**
```solidity
if (FHE.lt(a, b)) { ... }             // ❌ ebool is bytes32, not bool
FHE.select(FHE.lt(a, b), x, y)       // ✅ encrypted conditional
```

**5. Never revert on encrypted conditions — use the no-revert (silent-zero) pattern.**
```solidity
// ✅ insufficient balance → transfer 0, no revert, no information leak
ebool ok     = FHE.le(amount, _balances[from]);
euint64 actual = FHE.select(ok, amount, FHE.asEuint64(0));
_balances[from] = FHE.sub(_balances[from], actual);
_balances[to]   = FHE.add(_balances[to],   actual);
FHE.allowThis(_balances[from]); FHE.allow(_balances[from], from);
FHE.allowThis(_balances[to]);   FHE.allow(_balances[to],   to);
```

---

## Required Imports

```solidity
// Core library — import only the types you use
import {FHE, euint64, euint32, euint8, ebool, eaddress,
        externalEuint64, externalEuint32, externalEuint8,
        externalEbool, externalEaddress} from "@fhevm/solidity/lib/FHE.sol";

// Network config — always required, both Sepolia and mainnet use this import
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
```

---

## Encrypted Types

| Type | Plaintext | User Input Type |
|---|---|---|
| `euint8` | `uint8` | `externalEuint8` |
| `euint16` | `uint16` | `externalEuint16` |
| `euint32` | `uint32` | `externalEuint32` |
| `euint64` | `uint64` | `externalEuint64` |
| `euint128` | `uint128` | `externalEuint128` |
| `euint256` | `uint256` | `externalEuint256` |
| `ebool` | `bool` | `externalEbool` |
| `eaddress` | `address` | `externalEaddress` |

Use the **smallest type that fits your data** — larger types cost more HCU (gas).

---

## Core Patterns

### Receiving encrypted input (every public write function)

```solidity
function deposit(externalEuint64 encAmount, bytes calldata inputProof) external {
    euint64 amount = FHE.fromExternal(encAmount, inputProof);
    // Multiple inputs share one proof:
    // euint64 a = FHE.fromExternal(encA, inputProof);
    // ebool   b = FHE.fromExternal(encB, inputProof);
    _balances[msg.sender] = FHE.add(_balances[msg.sender], amount);
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);
}
```

### Arithmetic (prefer scalar operands — cheaper HCU)

```solidity
FHE.add(a, b)       FHE.add(a, 100)     // scalar is cheaper
FHE.sub(a, b)       FHE.mul(a, 3)
FHE.div(a, 4)       // divisor MUST be plaintext
FHE.min(a, b)       FHE.max(a, b)       FHE.neg(a)
```

### Comparisons → `ebool`

```solidity
FHE.eq(a,b)  FHE.ne(a,b)  FHE.lt(a,b)  FHE.le(a,b)  FHE.gt(a,b)  FHE.ge(a,b)
// All accept plaintext scalar as second arg: FHE.gt(balance, 1000)
```

### Casting

```solidity
euint64 enc    = FHE.asEuint64(42);         // plaintext → encrypted
euint64 larger = FHE.asEuint64(euint32val); // upcast: safe
euint8  small  = FHE.asEuint8(euint64val);  // downcast: TRUNCATES silently
eaddress eAddr = FHE.asEaddress(msg.sender);
euint64  rand  = FHE.randEuint64();          // on-chain randomness
```

### Access control

```solidity
FHE.allowThis(handle);              // contract keeps access next tx — REQUIRED
FHE.allow(handle, addr);            // addr can decrypt — for users
FHE.allowTransient(handle, addr);   // this tx only — for cross-contract calls
FHE.makePubliclyDecryptable(handle); // public reveal (auction end, vote result)
```

> Full ACL rules and both decryption flows (user EIP-712 + public): see
> **`references/acl-and-decryption.md`**

---

## Minimal Working Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract MinimalVault is ZamaEthereumConfig {
    mapping(address => euint64) private _balances;

    function deposit(externalEuint64 enc, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(enc, proof);
        _balances[msg.sender] = FHE.add(_balances[msg.sender], amount);
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);
    }

    function balanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }
}
```

---

## Environment Setup

```bash
# 1. Use the official template
#    https://github.com/zama-ai/fhevm-hardhat-template → "Use this template"
git clone <your-fork> && cd <your-fork> && npm install

# 2. Set secrets (for Sepolia)
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_KEY

# 3. Run tests (mock FHE — fastest)
npx hardhat test

# 4. Deploy
npx hardhat run scripts/deploy.ts --network sepolia
```

Key `hardhat.config.ts` requirements:
```typescript
import "@fhevm/hardhat-plugin";                  // must come first
// evmVersion: "cancun" — required for EIP-1153 transient storage (allowTransient)
```

> Full `hardhat.config.ts`, `package.json`, and `tsconfig.json` templates:
> see **`assets/config/`**
>
> **Version pinning**: The `package.json` template pins exact versions that exist
> on npm. Do NOT use `^0.9.0` for `@fhevm/hardhat-plugin` or `@fhevm/solidity` —
> those ranges resolve to versions that don't exist. Use the pinned versions in
> the template (`0.4.2`, `0.11.1`, `0.4.0`).

---

## Deployment

### Constructor arguments — you MUST customize deploy.ts

The `assets/scripts/deploy.ts` template defaults to `ERC7984Token` constructor args.
**Every FHEVM contract has different constructor parameters.** Before deploying, you
MUST edit two things in the script:

1. `CONTRACT_NAME` — set to your Solidity contract name
2. `buildConstructorArgs()` — return the correct args for your constructor

Common patterns:

```typescript
// ERC7984Token(address owner, string name, string symbol, string uri)
const constructorArgs = [deployer.address, "Token Name", "SYM", "https://..."];

// ConfidentialVoting(string question, uint256 deadline)
const deadline = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
const constructorArgs = ["Should we upgrade?", deadline];

// BlindAuction(address beneficiary, uint256 endTime)
const endTime = Math.floor(Date.now() / 1000) + (3 * 24 * 60 * 60);
const constructorArgs = [deployer.address, endTime];
```

If you deploy with the wrong args (wrong count, wrong types, or missing args),
the transaction will revert immediately.

### Mock FHE vs real FHE — when deploy reverts locally

If a contract's constructor calls `FHE.asEuint64()` or any FHE operation to
initialize encrypted state, deploying via `hardhat run` against the in-memory
Hardhat network **will revert**. This is because the FHEVM mock coprocessor is
only wired up during the `hardhat test` runner.

- **To test deployment locally**: use `hardhat test` with a deployment fixture
- **To deploy for real**: target Sepolia or Mainnet where the real coprocessor runs

```bash
# This will revert if constructor uses FHE ops:
npx hardhat run scripts/deploy.ts              # ❌ local — mock not active

# These work:
npx hardhat test                                # ✅ mock active in test runner
npx hardhat run scripts/deploy.ts --network sepolia  # ✅ real coprocessor
```

---

## Reference Files

Load these when the task requires deeper knowledge. Don't load all at once —
pick the one relevant to what you're building.

| File | Load when... |
|---|---|
| `references/acl-and-decryption.md` | ACL rules, user decryption (EIP-712), public decryption |
| `references/operations.md` | Full operator tables, HCU costs, bitwise ops, all casting rules |
| `references/erc7984.md` | ERC-7984 interface, extensions (Freezable, Wrapper, Votes), OZ patterns |
| `references/testing-and-deployment.md` | Hardhat test helpers, all test patterns, deploy scripts |
| `references/frontend.md` | fhevmjs/relayer-sdk: encrypt, decrypt, React hooks, Vite config |
| `references/anti-patterns.md` | 15 documented bugs with broken + fixed code — check before shipping |
| `references/migration.md` | Converting existing Solidity contracts to FHEVM step-by-step |

## Asset Files

Complete, copy-paste-ready files — copy to your project and adapt.

| File | What it is |
|---|---|
| `assets/contracts/ERC7984Token.sol` | Production ERC-7984 confidential token |
| `assets/contracts/ConfidentialVoting.sol` | Encrypted voting with reveal |
| `assets/contracts/BlindAuction.sol` | Sealed-bid auction |
| `assets/contracts/WrappedToken.sol` | ERC-20 → ERC-7984 wrapper |
| `assets/test/ERC7984Token.test.ts` | Full Hardhat test suite |
| `assets/test/ConfidentialVoting.test.ts` | Voting contract tests |
| `assets/test/BlindAuction.test.ts` | Auction contract tests |
| `assets/scripts/deploy.ts` | Generic deployment script — edit CONTRACT_NAME and constructor args |
| `assets/scripts/interact.ts` | Post-deploy interaction and verify script |
| `assets/scripts/fhevm-client.ts` | Full TypeScript SDK: encrypt, decrypt, React hooks |
| `assets/config/hardhat.config.ts` | Complete Hardhat config |
| `assets/config/package.json` | All FHEVM dependencies pinned |
| `assets/config/tsconfig.json` | TypeScript config |
