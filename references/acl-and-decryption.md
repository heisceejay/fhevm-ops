# ACL and Decryption

## Access Control (ACL) — The #1 Source of Bugs

Every encrypted state update requires ACL calls immediately after. Forgetting them
compiles fine but users can't decrypt their own data. No error is thrown.

### The Four ACL Functions

| Function | Storage | When to use |
|---|---|---|
| `FHE.allowThis(handle)` | Persistent | After EVERY state write — contract keeps access |
| `FHE.allow(handle, addr)` | Persistent | User needs to decrypt this value |
| `FHE.allowTransient(handle, addr)` | Transient (EIP-1153) | Passing handle to another contract in same tx |
| `FHE.makePubliclyDecryptable(handle)` | Persistent | Public reveal at end of auction/vote/game |

### The Required Pattern — Every Single State Mutation

```solidity
// Pattern: assign THEN allow (never the other way around)
_balances[msg.sender] = FHE.add(_balances[msg.sender], amount); // creates new handle
FHE.allowThis(_balances[msg.sender]);          // grants the NEW handle
FHE.allow(_balances[msg.sender], msg.sender);  // user can decrypt their balance
```

**Why order matters:** `FHE.add()` creates a brand-new handle. If you call
`allowThis` before the assignment, you're granting permission to the old handle.
The new handle stored in `_balances[msg.sender]` has no permission — silent failure.

### Cross-Contract Calls (Transient Allowance)

```solidity
// Caller: grant transient access BEFORE the external call
euint64 balance = _balances[msg.sender];
FHE.allowTransient(balance, address(dexContract)); // valid this tx only
dexContract.swap(balance); // dex can use `balance` handle

// Receiver (DEX contract):
function swap(euint64 inAmount) external {
    // inAmount is accessible — caller did allowTransient
    euint64 outAmount = FHE.mul(inAmount, rate);
    FHE.allowThis(outAmount);
    FHE.allow(outAmount, msg.sender);
}
```

### Checking Permissions

```solidity
// Guard a function: only ACL-authorized callers can use the handle
require(FHE.isSenderAllowed(handle), "Not authorized");

// Check if a handle was made publicly decryptable
bool isPublic = FHE.isPubliclyDecryptable(handle);
```

### Public Reveal

```solidity
function publishResults() external onlyAdmin {
    // Anyone can now decrypt via the Gateway off-chain
    FHE.makePubliclyDecryptable(_winnerScore);
    FHE.makePubliclyDecryptable(_winnerAddress);
}
```

---

## User Decryption (EIP-712 Signing Flow)

Users decrypt their own data entirely off-chain. The contract only needs
`FHE.allow(handle, userAddress)` — no special on-chain function needed.

### Contract Side

```solidity
// In your state-updating function, grant user access:
FHE.allow(_balances[msg.sender], msg.sender);

// Expose the handle via a view function:
function getEncryptedBalance(address account) external view returns (euint64) {
    return _balances[account];
}
```

### Frontend/TypeScript Side

```typescript
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";
import { ethers } from "ethers";

async function decryptUserBalance(
  signer: ethers.Signer,
  contract: ethers.Contract,
): Promise<bigint> {
  const instance        = await createInstance(SepoliaConfig);
  const userAddress     = await signer.getAddress();
  const contractAddress = await contract.getAddress();

  // Step 1: Generate ephemeral keypair (stays client-side, never sent anywhere)
  const { publicKey, privateKey } = instance.generateKeypair();

  // Step 2: Sign EIP-712 message — proves identity to the KMS
  const eip712 = instance.createEIP712(publicKey, contractAddress);
  const signature = await signer.signTypedData(
    eip712.domain,
    { Reencrypt: eip712.types.Reencrypt },
    eip712.message,
  );

  // Step 3: Fetch the handle from contract (bytes32)
  const handle = await contract.getEncryptedBalance(userAddress);
  if (handle === "0x" + "0".repeat(64)) return 0n; // uninitialized

  // Step 4: Gateway re-encrypts under user's publicKey; client decrypts locally
  return instance.reencrypt(
    handle, privateKey, publicKey, signature, contractAddress, userAddress,
  );
}
```

### In Hardhat Tests

```typescript
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

// Handles the full EIP-712 flow automatically in the mock environment
const balance = await fhevm.userDecryptEuint(
  FhevmType.euint64,
  handle,
  contractAddress,
  signer, // the signer who has ACL permission
);
```

---

## Public Decryption

After `FHE.makePubliclyDecryptable(handle)`, anyone can decrypt without signing:

```typescript
const instance  = await createInstance(SepoliaConfig);
const handle    = await contract.getWinnerScore();
const cleartext = await instance.publicDecrypt(handle, "uint64");
// type options: "bool" | "uint8" | "uint16" | "uint32" | "uint64"
//              | "uint128" | "uint256" | "address"
```

---

## Common ACL Mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Missing `allowThis` after update | Contract can't reuse handle next tx | Add after every assignment |
| `allowThis` before assignment | Grants old handle, not new | Always assign first |
| Missing `allow(handle, user)` | User's `reencrypt()` call fails silently | Add after assignment |
| `allowTransient` missing before cross-contract call | Called contract can't use handle | Add before the call |
| Granting to wrong address | Wrong user can decrypt | Double-check address param |
