/**
 * fhevm-client.ts
 * Frontend integration for FHEVM confidential contracts.
 *
 * Covers:
 * - SDK initialization (browser)
 * - Encrypt values for contract input
 * - User decryption via EIP-712 signing
 * - Public decryption for revealed values
 * - React hooks pattern
 *
 * Install: npm install @zama-fhe/relayer-sdk ethers
 *
 * Bundler note (Vite):
 *   // vite.config.ts
 *   export default defineConfig({
 *     optimizeDeps: { exclude: ["@zama-fhe/relayer-sdk"] },
 *     build: { target: "esnext" },
 *   });
 */

import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk";
import { BrowserProvider, Contract, ethers } from "ethers";
import { useState, useCallback, useRef } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FhevmClient {
  instance: FhevmInstance;
  provider: BrowserProvider;
}

// ── Initialization ───────────────────────────────────────────────────────────

let _cachedClient: FhevmClient | null = null;

/**
 * Initialize the FHEVM SDK.
 * Call once per page load (or once per network connection).
 *
 * @throws if window.ethereum is not available or SDK fails to init
 */
export async function initFhevmClient(): Promise<FhevmClient> {
  if (_cachedClient) return _cachedClient;

  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("window.ethereum not found — install MetaMask or a Web3 wallet");
  }

  const provider = new BrowserProvider(window.ethereum);
  const instance = await createInstance(SepoliaConfig);

  if (!instance.publicKey) {
    throw new Error(
      "FHEVM SDK failed to initialize.\n" +
      "Check:\n" +
      "  - relayerUrl is reachable: " + SepoliaConfig.relayerUrl + "\n" +
      "  - gatewayUrl is reachable: " + SepoliaConfig.gatewayUrl + "\n" +
      "  - You are connected to Sepolia (chainId 11155111)\n" +
      "  - WASM is bundled (use Vite with optimizeDeps.exclude)"
    );
  }

  _cachedClient = { instance, provider };
  return _cachedClient;
}

// ── Encrypt ──────────────────────────────────────────────────────────────────

/**
 * Encrypt a single euint64 value for a contract call.
 *
 * @param contractAddress  The contract that will receive the encrypted value
 * @param userAddress      The address sending the transaction
 * @param value            Plaintext bigint to encrypt
 * @returns { handle, inputProof } to pass as (externalEuint64, bytes) to contract
 */
export async function encryptUint64(
  contractAddress: string,
  userAddress: string,
  value: bigint,
): Promise<{ handle: string; inputProof: string }> {
  const { instance } = await initFhevmClient();

  const encInput = instance.createEncryptedInput(contractAddress, userAddress);
  encInput.add64(value);
  const { handles, inputProof } = await encInput.encrypt();

  return { handle: handles[0], inputProof };
}

/**
 * Encrypt multiple values in one proof (more gas-efficient than separate calls).
 *
 * @example
 * const { handles, inputProof } = await encryptMultiple(contract, user, [
 *   { type: "uint64", value: 1000n },
 *   { type: "bool",   value: true  },
 *   { type: "uint8",  value: 3     },
 * ]);
 * // handles[0] = encrypted 1000n (externalEuint64)
 * // handles[1] = encrypted true  (externalEbool)
 * // handles[2] = encrypted 3     (externalEuint8)
 * // inputProof covers all three
 */
export type EncryptableValue =
  | { type: "uint8";   value: number  }
  | { type: "uint16";  value: number  }
  | { type: "uint32";  value: number  }
  | { type: "uint64";  value: bigint  }
  | { type: "uint128"; value: bigint  }
  | { type: "bool";    value: boolean }
  | { type: "address"; value: string  };

export async function encryptMultiple(
  contractAddress: string,
  userAddress: string,
  values: EncryptableValue[],
): Promise<{ handles: string[]; inputProof: string }> {
  const { instance } = await initFhevmClient();
  const encInput = instance.createEncryptedInput(contractAddress, userAddress);

  for (const v of values) {
    switch (v.type) {
      case "uint8":   encInput.add8(v.value);       break;
      case "uint16":  encInput.add16(v.value);      break;
      case "uint32":  encInput.add32(v.value);      break;
      case "uint64":  encInput.add64(v.value);      break;
      case "uint128": encInput.add128(v.value);     break;
      case "bool":    encInput.addBool(v.value);    break;
      case "address": encInput.addAddress(v.value); break;
    }
  }

  const { handles, inputProof } = await encInput.encrypt();
  return { handles, inputProof };
}

// ── User Decryption ───────────────────────────────────────────────────────────

/**
 * Decrypt a user's own encrypted value (requires ACL permission on handle).
 *
 * Flow:
 *   1. Generate ephemeral keypair (stays client-side)
 *   2. Sign EIP-712 message proving identity to KMS
 *   3. Gateway re-encrypts value under user's publicKey
 *   4. Client decrypts with privateKey
 *
 * @param handle          bytes32 handle from contract (e.g., from confidentialBalanceOf())
 * @param contractAddress Contract that holds the encrypted state
 * @param userAddress     Address that has ACL permission (from FHE.allow in contract)
 * @param signer          ethers Signer for the user
 * @returns Decrypted plaintext as bigint
 */
export async function userDecrypt(
  handle: string,
  contractAddress: string,
  userAddress: string,
  signer: ethers.Signer,
): Promise<bigint> {
  // Uninitialized handle
  if (handle === "0x" + "0".repeat(64)) return 0n;

  const { instance } = await initFhevmClient();

  // Step 1: ephemeral keypair
  const { publicKey, privateKey } = instance.generateKeypair();

  // Step 2: EIP-712 sign
  const eip712 = instance.createEIP712(publicKey, contractAddress);
  const signature = await signer.signTypedData(
    eip712.domain,
    { Reencrypt: eip712.types.Reencrypt },
    eip712.message,
  );

  // Steps 3 + 4: gateway re-encrypts, client decrypts
  const result = await instance.reencrypt(
    handle,
    privateKey,
    publicKey,
    signature,
    contractAddress,
    userAddress,
  );

  return result;
}

// ── Public Decryption ─────────────────────────────────────────────────────────

/**
 * Decrypt a publicly revealed value (after contract called makePubliclyDecryptable).
 *
 * No signature required — anyone can decrypt.
 *
 * @param handle    bytes32 handle (must have been made publicly decryptable)
 * @param valueType Type hint for decoding ("uint8"|"uint16"|...|"bool"|"address")
 */
export async function publicDecrypt(
  handle: string,
  valueType: "bool" | "uint8" | "uint16" | "uint32" | "uint64" | "uint128" | "uint256" | "address",
): Promise<bigint | boolean | string> {
  const { instance } = await initFhevmClient();
  return instance.publicDecrypt(handle, valueType);
}

// ── React Hooks ───────────────────────────────────────────────────────────────

/**
 * React hook: decrypt and display a user's encrypted balance.
 *
 * @example
 * const { balance, loading, error, refresh } = useConfidentialBalance(
 *   token,
 *   await token.getAddress(),
 *   signer,
 * );
 *
 * // In JSX:
 * <button onClick={() => refresh()}>Refresh Balance</button>
 * {loading ? <Spinner /> : <span>{balance?.toString() ?? "—"}</span>}
 */
export function useConfidentialBalance(
  contract: Contract | null,
  contractAddress: string,
  signer: ethers.Signer | null,
) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const pendingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!contract || !signer || pendingRef.current) return;

    pendingRef.current = true;
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
      pendingRef.current = false;
    }
  }, [contract, contractAddress, signer]);

  return { balance, loading, error, refresh };
}

/**
 * React hook: encrypt a value and send a confidential transfer.
 *
 * @example
 * const { transfer, pending, error } = useConfidentialTransfer(token, signer);
 * await transfer(recipientAddress, 500n);
 */
export function useConfidentialTransfer(
  contract: Contract | null,
  signer: ethers.Signer | null,
) {
  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const transfer = useCallback(async (
    to: string,
    amount: bigint,
  ): Promise<string | null> => {
    if (!contract || !signer) return null;

    setPending(true);
    setError(null);

    try {
      const userAddress = await signer.getAddress();
      const contractAddress = await contract.getAddress();

      const { handle, inputProof } = await encryptUint64(
        contractAddress,
        userAddress,
        amount,
      );

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
  }, [contract, signer]);

  return { transfer, pending, error };
}
