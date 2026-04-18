# FHE Operations Reference

## Arithmetic

| Function | Encrypted OP Encrypted | Encrypted OP Scalar | Notes |
|---|---|---|---|
| `FHE.add(a, b)` | ✅ | ✅ cheaper | Overflows silently |
| `FHE.sub(a, b)` | ✅ | ✅ cheaper | Underflows silently |
| `FHE.mul(a, b)` | ✅ | ✅ cheaper | — |
| `FHE.div(a, b)` | ❌ | ✅ only | Encrypted divisor unsupported |
| `FHE.rem(a, b)` | ❌ | ✅ only | Encrypted divisor unsupported |
| `FHE.neg(a)` | unary | — | — |
| `FHE.min(a, b)` | ✅ | ✅ | — |
| `FHE.max(a, b)` | ✅ | ✅ | — |

## Comparisons (all return `ebool`)

| Function | Meaning | Scalar OK? |
|---|---|---|
| `FHE.eq(a, b)` | `a == b` | ✅ |
| `FHE.ne(a, b)` | `a != b` | ✅ |
| `FHE.lt(a, b)` | `a < b` | ✅ |
| `FHE.le(a, b)` | `a <= b` | ✅ |
| `FHE.gt(a, b)` | `a > b` | ✅ |
| `FHE.ge(a, b)` | `a >= b` | ✅ |

## Bitwise

| Function | Meaning | Notes |
|---|---|---|
| `FHE.and(a, b)` | `a & b` | — |
| `FHE.or(a, b)` | `a \| b` | — |
| `FHE.xor(a, b)` | `a ^ b` | — |
| `FHE.not(a)` | `~a` | Unary |
| `FHE.shl(a, n)` | `a << n` | n mod bit-width (≠ Solidity `<<` for n ≥ width) |
| `FHE.shr(a, n)` | `a >> n` | n mod bit-width |
| `FHE.rotl(a, n)` | rotate left | n = uint8 |
| `FHE.rotr(a, n)` | rotate right | n = uint8 |

> **Shift difference:** `FHE.shl(x, 70)` on `euint64` = `FHE.shl(x, 6)` (70 % 64).
> Solidity `uint64(1) << 70` = 0 (shifted out). Guard with `amount % 64` if needed.

## Conditional Selection (Only Branch Mechanism)

```solidity
// FHE.select is the ONLY way to branch on an encrypted condition
euint64 result = FHE.select(
    condition,   // ebool
    trueValue,   // euintX
    falseValue   // euintX
);

// Both branches execute in FHE math; only the selected value emerges
// No if/require on ebool — ebool is bytes32, not bool
```

## Type Casting

```solidity
// Plaintext → encrypted (trivial encryption)
euint8    FHE.asEuint8(uint8 v)
euint16   FHE.asEuint16(uint16 v)
euint32   FHE.asEuint32(uint32 v)
euint64   FHE.asEuint64(uint64 v)
euint128  FHE.asEuint128(uint128 v)
euint256  FHE.asEuint256(uint256 v)
ebool     FHE.asEbool(bool v)
eaddress  FHE.asEaddress(address v)

// Between encrypted types
euint64  FHE.asEuint64(euint32 v)    // UPCAST — safe, no data loss
euint8   FHE.asEuint8(euint64 v)     // DOWNCAST — truncates! 300 → 44 (300%256)

// Validate external user input (always required before use)
euint64  FHE.fromExternal(externalEuint64 enc, bytes calldata proof)
ebool    FHE.fromExternal(externalEbool   enc, bytes calldata proof)
eaddress FHE.fromExternal(externalEaddress enc, bytes calldata proof)
// ... same pattern for all externalEuintX types
```

## Randomness

```solidity
euint8   r = FHE.randEuint8();
euint16  r = FHE.randEuint16();
euint32  r = FHE.randEuint32();
euint64  r = FHE.randEuint64();
euint128 r = FHE.randEuint128();
euint256 r = FHE.randEuint256();
// Cryptographically secure; safe to use on-chain; deterministic across coprocessors
```

---

## HCU — Homomorphic Complexity Units

HCU is the computational budget per transaction. Every FHE operation costs HCU.

**Transaction limits:**
- Sequential operations: 5,000,000 HCU
- Parallel operations: 20,000,000 HCU total

**Cost scaling:** `euint8 < euint16 < euint32 < euint64 < euint128 < euint256`

### Optimization Rules

```solidity
// ✅ Smallest type that fits the data range
euint8  level = FHE.asEuint8(3);    // 0-255 → use euint8, not euint64
euint64 bal   = FHE.asEuint64(x);   // token balances → euint64 is standard

// ✅ Scalar operands over encrypted (significantly cheaper)
euint64 r1 = FHE.add(balance, 1000);            // cheap: enc + scalar
euint64 r2 = FHE.add(balance, FHE.asEuint64(1000)); // expensive: enc + enc

// ❌ Loop over encrypted values — N iterations = N × HCU cost
for (uint i = 0; i < recipients.length; i++) {
    _balances[recipients[i]] = FHE.add(...); // hits HCU limit at ~50 recipients
}
// ✅ Pattern: let users claim individually instead (1 op per tx)
```

---

## Overflow / Underflow Guards

Encrypted integers wrap around silently. For critical operations, guard explicitly:

```solidity
// Overflow-safe add
euint64 newVal = FHE.add(a, b);
ebool overflow = FHE.lt(newVal, a);                       // wrapped if new < old
euint64 safe   = FHE.select(overflow, a, newVal);         // revert-to-old on overflow

// Underflow-safe sub (same as no-revert transfer pattern)
ebool ok        = FHE.ge(a, b);
euint64 delta   = FHE.select(ok, b, FHE.asEuint64(0));
euint64 safe    = FHE.sub(a, delta);
```
