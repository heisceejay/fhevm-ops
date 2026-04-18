# FHEVM Anti-Patterns — What NOT to Do

Every entry: the broken version, why it breaks, and the correct fix.
These are the most common bugs in real FHEVM codebases.

---

## AP-01: Missing `ZamaEthereumConfig` Inheritance

**Symptom:** Contract compiles, deploys, but FHE operations silently fail or revert.

```solidity
// ❌ BROKEN — no coprocessor/ACL registered
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";

contract Vault {
    mapping(address => euint64) private _balances;
    // FHE calls will fail at runtime
}
```

```solidity
// ✅ CORRECT
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract Vault is ZamaEthereumConfig {  // ← REQUIRED, must be first in list
    mapping(address => euint64) private _balances;
}
```

---

## AP-02: Not Calling `FHE.allowThis()` After State Update

**Symptom:** Works in the same transaction, silently breaks in the next one. Contract can't read its own encrypted state.

```solidity
// ❌ BROKEN — contract loses access to _counter in the next transaction
function increment(externalEuint32 enc, bytes calldata proof) external {
    euint32 val = FHE.fromExternal(enc, proof);
    _counter = FHE.add(_counter, val);
    // FHE.allowThis(_counter) MISSING — next call to FHE.add(_counter, ...) fails
}
```

```solidity
// ✅ CORRECT
function increment(externalEuint32 enc, bytes calldata proof) external {
    euint32 val = FHE.fromExternal(enc, proof);
    _counter = FHE.add(_counter, val);
    FHE.allowThis(_counter);         // ← contract can reuse next tx
    FHE.allow(_counter, msg.sender); // ← user can decrypt
}
```

---

## AP-03: Calling `FHE.allowThis()` BEFORE the Assignment (Stale Handle)

**Symptom:** The old handle gets the permission; the new handle (after assignment) has none.

```solidity
// ❌ BROKEN — allowThis() on the OLD value; new handle has no permission
FHE.allowThis(_balances[msg.sender]);                        // grants old handle
_balances[msg.sender] = FHE.add(_balances[msg.sender], v);  // creates NEW handle
// The new handle stored in _balances[msg.sender] has NO ACL permission!
```

```solidity
// ✅ CORRECT — always call allowThis() AFTER the assignment
_balances[msg.sender] = FHE.add(_balances[msg.sender], v);  // creates new handle
FHE.allowThis(_balances[msg.sender]);   // ← grants the new handle
FHE.allow(_balances[msg.sender], msg.sender);
```

---

## AP-04: Accepting a Raw `euintX` from User Input (No Proof)

**Symptom:** Users can pass arbitrary handles, replay handles from other contracts, or forge inputs.

```solidity
// ❌ BROKEN — accepts any bytes32 with no proof; no binding to caller/contract
function deposit(euint64 amount) external {
    _balances[msg.sender] = FHE.add(_balances[msg.sender], amount);
    // An attacker can pass someone else's handle here
}
```

```solidity
// ✅ CORRECT — validates ZKPoK binding input to this contract AND msg.sender
function deposit(externalEuint64 encAmount, bytes calldata inputProof) external {
    euint64 amount = FHE.fromExternal(encAmount, inputProof);
    // `amount` is now verified: encrypted by msg.sender, bound to this contract
    _balances[msg.sender] = FHE.add(_balances[msg.sender], amount);
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);
}
```

---

## AP-05: Using `if` or `require` on an `ebool`

**Symptom:** Compilation error, wrong behavior, or always takes one branch regardless of encrypted value.

```solidity
// ❌ BROKEN — ebool is bytes32, not bool; this may compile but behaves wrong
ebool isValid = FHE.ge(balance, amount);
if (isValid) {                           // wrong: comparing handle to zero
    _transfer(from, to, amount);
}

// ❌ ALSO BROKEN
require(FHE.gt(balance, 0), "Empty");   // FHE.gt returns ebool, not bool
```

```solidity
// ✅ CORRECT — use FHE.select for all branching on encrypted conditions
ebool canTransfer = FHE.le(amount, balance);
euint64 actualAmount = FHE.select(canTransfer, amount, FHE.asEuint64(0));
// Both branches execute in FHE; only the correct result is used
```

---

## AP-06: Reverting on Insufficient Balance (Information Leak)

**Symptom:** Reveals that the user had insufficient balance — an information leak.

```solidity
// ❌ BROKEN — leaks: "your balance is less than the amount you tried to transfer"
function transfer(address to, externalEuint64 enc, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(enc, proof);
    require(/* can't check this */ ...);  // impossible without decrypting
    _balances[from] = FHE.sub(_balances[from], amount);  // could underflow!
}
```

```solidity
// ✅ CORRECT — silent-zero (no-revert) pattern: insufficient = send 0, no info leak
function transfer(address to, externalEuint64 enc, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(enc, proof);
    ebool ok = FHE.le(amount, _balances[msg.sender]);
    euint64 actual = FHE.select(ok, amount, FHE.asEuint64(0));
    _balances[msg.sender] = FHE.sub(_balances[msg.sender], actual);
    _balances[to]         = FHE.add(_balances[to],         actual);
    FHE.allowThis(_balances[msg.sender]); FHE.allow(_balances[msg.sender], msg.sender);
    FHE.allowThis(_balances[to]);         FHE.allow(_balances[to], to);
}
```

---

## AP-07: Arithmetic Overflow / Underflow Without Guard

**Symptom:** Encrypted integers wrap around silently — `euint64` max + 1 = 0.

```solidity
// ❌ BROKEN — totalSupply can overflow to 0
function mint(externalEuint64 enc, bytes calldata proof) external onlyOwner {
    euint64 amount = FHE.fromExternal(enc, proof);
    _totalSupply = FHE.add(_totalSupply, amount);  // no overflow check!
    _balances[to] = FHE.add(_balances[to], amount);
}
```

```solidity
// ✅ CORRECT — detect overflow with FHE.lt(new, old); cancel if it occurs
function mint(externalEuint64 enc, bytes calldata proof) external onlyOwner {
    euint64 amount = FHE.fromExternal(enc, proof);
    euint64 newSupply = FHE.add(_totalSupply, amount);
    ebool overflow = FHE.lt(newSupply, _totalSupply); // wrapped if new < old
    _totalSupply  = FHE.select(overflow, _totalSupply, newSupply);
    euint64 newBal = FHE.add(_balances[to], amount);
    _balances[to]  = FHE.select(overflow, _balances[to], newBal);
    FHE.allowThis(_totalSupply);
    FHE.allowThis(_balances[to]); FHE.allow(_balances[to], to);
}
```

---

## AP-08: Passing Encrypted Values to External Contracts Without `allowTransient`

**Symptom:** Called contract can't use the handle — ACL check fails.

```solidity
// ❌ BROKEN — external contract has no ACL access to _balance
function swap(address dex) external {
    dexContract.provideLiquidity(_balances[msg.sender]);  // reverts: not allowed
}
```

```solidity
// ✅ CORRECT — grant transient access before the external call
function swap(address dex) external {
    euint64 balance = _balances[msg.sender];
    FHE.allowTransient(balance, address(dexContract)); // this tx only
    dexContract.provideLiquidity(balance);             // dex can now use it
}
```

---

## AP-09: Emitting Encrypted Values in Events

**Symptom:** Encrypted handle values in logs don't help off-chain listeners (who can't decrypt) but do reveal metadata about the operation.

```solidity
// ❌ AWKWARD — emitting a handle that most listeners can't use
event Transfer(address indexed from, address indexed to, euint64 amount);
// `amount` in the log is a bytes32 handle — not useful to most consumers
```

```solidity
// ✅ CORRECT — emit only public metadata; decrypt off-chain if needed
event Transfer(address indexed from, address indexed to);
// Off-chain: authorized parties call getEncryptedBalance() and decrypt via SDK
```

---

## AP-10: Using Oversized Encrypted Types

**Symptom:** Higher HCU costs than necessary — can hit transaction HCU limits.

```solidity
// ❌ WASTEFUL — euint128 for a value that never exceeds 255
euint128 userLevel = FHE.asEuint128(3);      // burns unnecessary HCU
euint128 pct       = FHE.asEuint128(75);     // 0-100 — way too big
```

```solidity
// ✅ EFFICIENT — smallest type that fits the data range
euint8  userLevel = FHE.asEuint8(3);        // 0-255, perfectly sized
euint8  pct       = FHE.asEuint8(75);       // 0-100, smallest fit

// For token balances: euint64 is standard (same as ERC-7984)
// For large amounts: euint128 if >2^64 - 1
```

---

## AP-11: Using Encrypted-Encrypted Operations When Scalar Would Do

**Symptom:** Significantly higher HCU cost for same logical result.

```solidity
// ❌ EXPENSIVE — encrypts a constant just to add it
euint64 fee = FHE.asEuint64(1000);
euint64 total = FHE.add(balance, fee);   // encrypted + encrypted: high HCU
```

```solidity
// ✅ CHEAPER — scalar operand when one value is a constant
euint64 total = FHE.add(balance, 1000); // encrypted + plaintext scalar: low HCU
```

---

## AP-12: FHE Operations in Constructor on Real Networks

**Symptom:** Works on Hardhat mock, fails or behaves unexpectedly on Sepolia.

```solidity
// ⚠️ RISKY — may cause issues on real networks during deployment
constructor() {
    _secret = FHE.randEuint64();  // random ops in constructor can fail
    FHE.allowThis(_secret);
}
```

```solidity
// ✅ SAFE — initialize in constructor only with deterministic values
constructor() {
    _counter = FHE.asEuint64(0);  // deterministic trivial encryption: OK
    FHE.allowThis(_counter);
    FHE.allow(_counter, msg.sender);
}

// Or: use a separate initialize() function called post-deployment
function initialize() external onlyOwner {
    _secret = FHE.randEuint64();
    FHE.allowThis(_secret);
}
```

---

## AP-13: Looping Over Encrypted Values

**Symptom:** HCU limit exceeded; transaction reverts.

```solidity
// ❌ BROKEN — N encrypted operations = N × HCU; hits limit for large arrays
function distributeRewards(address[] calldata recipients, uint64 amount) external {
    for (uint i = 0; i < recipients.length; i++) {
        _balances[recipients[i]] = FHE.add(_balances[recipients[i]], FHE.asEuint64(amount));
        FHE.allowThis(_balances[recipients[i]]);
        FHE.allow(_balances[recipients[i]], recipients[i]);
    }
}
// If recipients.length > ~50, this likely hits the HCU limit
```

```solidity
// ✅ ALTERNATIVE 1 — let users claim their own reward (1 op per tx)
mapping(address => bool) public canClaim;

function setupClaim(address[] calldata recipients) external onlyOwner {
    for (uint i = 0; i < recipients.length; i++) {
        canClaim[recipients[i]] = true; // public mapping, no FHE cost
    }
}

function claim() external {
    require(canClaim[msg.sender], "Not eligible");
    canClaim[msg.sender] = false;
    _balances[msg.sender] = FHE.add(_balances[msg.sender], FHE.asEuint64(rewardAmount));
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);
}

// ✅ ALTERNATIVE 2 — batch in groups of ~20 with separate transactions
```

---

## AP-14: Checking `_balance == 0` as Initialization Guard

**Symptom:** Can't distinguish "uninitialized (bytes32(0))" from "zero balance" directly.

```solidity
// ❌ BROKEN — bytes32(0) is the uninitialized handle, not "balance = 0"
function isInitialized() external view returns (bool) {
    return _balances[msg.sender] != 0; // always false if uninitialized
}
```

```solidity
// ✅ CORRECT — check the handle directly as bytes32
function isInitialized(address user) external view returns (bool) {
    return euint64.unwrap(_balances[user]) != bytes32(0);
}

// Or: use a separate bool initialized[address] mapping
mapping(address => bool) private _initialized;

function deposit(externalEuint64 enc, bytes calldata proof) external {
    euint64 amount = FHE.fromExternal(enc, proof);
    if (!_initialized[msg.sender]) {
        _balances[msg.sender] = amount;
        _initialized[msg.sender] = true;
    } else {
        _balances[msg.sender] = FHE.add(_balances[msg.sender], amount);
    }
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);
}
```

---

## AP-15: Shift Operations Behave Differently from Solidity `<<`/`>>`

**Symptom:** Unexpected values after shift — not what you'd expect from Solidity shifts.

```solidity
// ⚠️ SURPRISING — FHE shifts use modulo, Solidity << does not
euint64 x = FHE.asEuint64(1);
euint64 r = FHE.shl(x, 70);  // 70 % 64 = 6, so this is shl(x, 6) = 64
// Solidity: uint64(1) << 70 = 0 (shifted out entirely)
```

```solidity
// ✅ BE EXPLICIT — ensure shift amount < bit-width
uint8 shift = amount % 64;  // normalize before passing
euint64 r = FHE.shl(x, shift);
```
