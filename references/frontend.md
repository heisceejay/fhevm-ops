# Frontend Integration

## Install

```bash
npm install @zama-fhe/relayer-sdk ethers
```

## Bundler Config (Vite — required for WASM)

```typescript
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@zama-fhe/relayer-sdk"],
  },
  build: {
    target: "esnext",
  },
});
```

Without this, the SDK's WebAssembly module will fail to load.

## Initialize the SDK

```typescript
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";
import { BrowserProvider } from "ethers";

// Call once per session — cache the result
let _instance: any = null;

export async function getFhevmInstance() {
  if (_instance) return _instance;
  _instance = await createInstance(SepoliaConfig);

  if (!_instance.publicKey) {
    throw new Error(
      "FHEVM init failed. Check:\n" +
      "  - You are on Sepolia (chainId 11155111)\n" +
      "  - relayerUrl is reachable: " + SepoliaConfig.relayerUrl + "\n" +
      "  - WASM is excluded from Vite's optimizeDeps"
    );
  }
  return _instance;
}
```

## Encrypt a Value for a Contract Call

```typescript
async function encryptUint64(
  contractAddress: string,
  userAddress: string,
  value: bigint,
): Promise<{ handle: string; inputProof: string }> {
  const instance = await getFhevmInstance();
  const encInput = instance.createEncryptedInput(contractAddress, userAddress);
  encInput.add64(value);
  const { handles, inputProof } = await encInput.encrypt();
  return { handle: handles[0], inputProof };
}
```

**All add methods:**
```typescript
encInput.add8(n)        // externalEuint8
encInput.add16(n)       // externalEuint16
encInput.add32(n)       // externalEuint32
encInput.add64(n)       // externalEuint64
encInput.add128(n)      // externalEuint128
encInput.add256(n)      // externalEuint256
encInput.addBool(bool)  // externalEbool
encInput.addAddress(str)// externalEaddress

// Multiple values share one inputProof:
encInput.add64(amount); // handles[0]
encInput.addBool(flag); // handles[1]
const { handles, inputProof } = await encInput.encrypt();
```

## Decrypt a User's Own Value

```typescript
async function userDecrypt(
  handle: string,
  contractAddress: string,
  userAddress: string,
  signer: any,
): Promise<bigint> {
  if (handle === "0x" + "0".repeat(64)) return 0n;

  const instance = await getFhevmInstance();

  // 1. Ephemeral keypair (client-side only)
  const { publicKey, privateKey } = instance.generateKeypair();

  // 2. EIP-712 sign to prove identity to KMS
  const eip712 = instance.createEIP712(publicKey, contractAddress);
  const signature = await signer.signTypedData(
    eip712.domain,
    { Reencrypt: eip712.types.Reencrypt },
    eip712.message,
  );

  // 3. Gateway re-encrypts; client decrypts with privateKey
  return instance.reencrypt(
    handle, privateKey, publicKey, signature, contractAddress, userAddress,
  );
}
```

## Public Decrypt (No Signature Needed)

```typescript
// After contract calls FHE.makePubliclyDecryptable(handle):
const instance  = await getFhevmInstance();
const cleartext = await instance.publicDecrypt(handle, "uint64");
// type: "bool" | "uint8" | "uint16" | "uint32" | "uint64" | "uint128" | "address"
```

## React Hooks

```typescript
import { useState, useCallback, useRef } from "react";

// Hook: read and decrypt user's balance
export function useConfidentialBalance(contract: any, contractAddress: string, signer: any) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    if (!contract || !signer || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      const userAddress = await signer.getAddress();
      const handle = await contract.confidentialBalanceOf(userAddress);
      const bal = await userDecrypt(handle, contractAddress, userAddress, signer);
      setBalance(bal);
    } catch (e: any) {
      setError(e?.message ?? "Decryption failed");
    } finally {
      setLoading(false);
      pending.current = false;
    }
  }, [contract, contractAddress, signer]);

  return { balance, loading, error, refresh };
}

// Hook: encrypt and send a confidential transfer
export function useConfidentialTransfer(contract: any, contractAddress: string, signer: any) {
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const transfer = useCallback(async (to: string, amount: bigint) => {
    if (!contract || !signer) return null;
    setPending(true);
    setError(null);
    try {
      const userAddress = await signer.getAddress();
      const { handle, inputProof } = await encryptUint64(contractAddress, userAddress, amount);
      const tx = await contract
        .connect(signer)
        ["confidentialTransfer(address,bytes32,bytes)"](to, handle, inputProof);
      await tx.wait();
      return tx.hash;
    } catch (e: any) {
      setError(e?.message ?? "Transfer failed");
      return null;
    } finally {
      setPending(false);
    }
  }, [contract, contractAddress, signer]);

  return { transfer, pending, error };
}
```

> Full typed SDK integration: `assets/scripts/fhevm-client.ts`

## Common Frontend Errors

| Error | Cause | Fix |
|---|---|---|
| `__wbindgen_malloc not found` | WASM not bundled | Add `optimizeDeps.exclude` to Vite config |
| `Invalid public key` | Wrong relayerUrl | Use `SepoliaConfig` or verify endpoint |
| `reencrypt` hangs | Wrong gatewayUrl | Check gateway health endpoint |
| `isSenderAllowed` fails | Missing `FHE.allow()` in contract | Add ACL grant in contract |
| Returns `bytes32(0)` | Handle never written | Check initialization; check ACL |
