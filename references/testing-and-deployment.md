# Testing and Deployment

## Test Modes

| Mode | Command | FHE | Speed | Use for |
|---|---|---|---|---|
| In-memory mock | `npx hardhat test` | ❌ | ⚡ Fastest | Dev, CI, coverage |
| Local node mock | `npx hardhat node` + `--network localhost` | ❌ | Fast | Frontend dev |
| Sepolia (real) | `npx hardhat test --network sepolia` | ✅ | Slow | Integration |

## Test File Boilerplate

```typescript
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// For ERC-7984: use selector strings for overloaded methods
const SIG_TRANSFER      = "confidentialTransfer(address,bytes32,bytes)";
const SIG_TRANSFER_FROM = "confidentialTransferFrom(address,address,bytes32,bytes)";

describe("MyContract", function () {
  let contract: any;
  let contractAddress: string;
  let owner: HardhatEthersSigner, alice: HardhatEthersSigner, bob: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    contract = await ethers.deployContract("MyContract", [/* args */]);
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function encrypt64(value: bigint, signer: HardhatEthersSigner) {
    return fhevm
      .createEncryptedInput(contractAddress, signer.address)
      .add64(value)
      .encrypt();
  }

  async function encryptBool(value: boolean, signer: HardhatEthersSigner) {
    return fhevm
      .createEncryptedInput(contractAddress, signer.address)
      .addBool(value)
      .encrypt();
  }

  // Decrypt euint64 — signer must have ACL access
  async function decrypt64(handle: string, signer: HardhatEthersSigner): Promise<bigint> {
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
  }

  // Decrypt euint32
  async function decrypt32(handle: string, signer: HardhatEthersSigner): Promise<bigint> {
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint32, handle, contractAddress, signer);
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  it("uninitialized handle is bytes32(0)", async function () {
    const handle = await contract.someEncryptedGetter(alice.address);
    expect(handle).to.equal(ethers.ZeroHash);
  });

  it("basic encrypted operation", async function () {
    const { handles, inputProof } = await encrypt64(500n, alice);
    await contract.connect(alice).someFunction(handles[0], inputProof);

    const handle = await contract.someGetter(alice.address);
    expect(await decrypt64(handle, alice)).to.equal(500n);
  });

  it("multiple inputs share one proof", async function () {
    const input = fhevm.createEncryptedInput(contractAddress, alice.address);
    input.add64(100n);   // handles[0]
    input.addBool(true); // handles[1]
    const { handles, inputProof } = await input.encrypt();

    await contract.connect(alice).twoParamFunction(
      handles[0], handles[1], inputProof
    );
  });
});
```

## FhevmType Values

```typescript
FhevmType.ebool    // encrypted bool
FhevmType.euint8   // encrypted uint8
FhevmType.euint16  // encrypted uint16
FhevmType.euint32  // encrypted uint32
FhevmType.euint64  // encrypted uint64
FhevmType.euint128 // encrypted uint128
FhevmType.euint256 // encrypted uint256
FhevmType.eaddress // encrypted address
```

## Debug Decryption (Local Mock Only)

```typescript
// Bypass EIP-712 in tests — NOT available on Sepolia/mainnet
import hre from "hardhat";
const clearValue = await hre.fhevm.decrypt64(handle);
```

## Time-Based Tests

```typescript
import { time } from "@nomicfoundation/hardhat-network-helpers";

// Advance time past a deadline
await time.increase(60 * 60 * 24); // +24 hours

// Set to a specific timestamp
await time.setNextBlockTimestamp(specificTimestamp);
```

## Checking Initialization

```typescript
// bytes32(0) = uninitialized — the mapping slot was never written
// NOT "the encrypted value is 0"
const handle = await contract.balanceOf(alice.address);
const isInitialized = handle !== ethers.ZeroHash;
```

---

## Deployment

### Deploy Script Pattern

```typescript
// scripts/deploy.ts
import { ethers, network } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying on:", network.name, "from:", deployer.address);

  const Contract = await ethers.getContractFactory("MyContract");
  const contract = await Contract.deploy(/* constructor args */);
  await contract.waitForDeployment();

  console.log("Deployed at:", await contract.getAddress());
  console.log("Tx:", contract.deploymentTransaction()?.hash);
}

main().catch(console.error);
```

```bash
# Deploy
npx hardhat run scripts/deploy.ts --network sepolia

# Verify FHEVM compatibility after deployment
npx hardhat fhevm check-fhevm-compatibility \
  --network sepolia \
  --address <deployed-address>

# Verify source on Etherscan
npx hardhat verify --network sepolia <address> <constructor-args...>
```

### Setting Hardhat Secrets

```bash
npx hardhat vars set MNEMONIC         # 12-word seed phrase
npx hardhat vars set INFURA_KEY       # Infura project ID
npx hardhat vars set ETHERSCAN_API_KEY
```

### Coverage

```bash
npx hardhat coverage      # mock mode only
open coverage/index.html
```

> Full deploy and interact scripts: `assets/scripts/deploy.ts`, `assets/scripts/interact.ts`
> Full hardhat.config.ts: `assets/config/hardhat.config.ts`
