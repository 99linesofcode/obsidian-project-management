// FNV-1a 64-bit hash, synchronous and deterministic. Used to fingerprint a
// note's body so a sync can detect local edits.
//
// WHY 64-bit: the 32-bit variant's birthday bound is small enough that two
// distinct task bodies collide with meaningful probability at realistic vault
// sizes, and a collision silently misses a change (the digests compare equal,
// so the edit never syncs). 64-bit pushes the birthday bound past any realistic
// task count. The multiply is decomposed into 32-bit hi/lo lanes with Math.imul
// so the hash stays synchronous and allocation-free — no BigInt.
const OFFSET_HI = 0xcbf29ce4;
const OFFSET_LO = 0x84222325;
// The 64-bit prime 0x100000001b3, split into its 32-bit halves.
const PRIME_HI = 0x00000100;
const PRIME_LO = 0x000001b3;

export function hash(input: string): string {
  let hi = OFFSET_HI;
  let lo = OFFSET_LO;
  for (let i = 0; i < input.length; i++) {
    // FNV-1a: XOR the octet into the low lane, then multiply by the prime
    // (mod 2^64).
    lo = (lo ^ input.charCodeAt(i)) >>> 0;
    const low = umul32(lo, PRIME_LO);
    const mid1 = umul32(hi, PRIME_LO);
    const mid2 = umul32(lo, PRIME_HI);
    lo = low.lo;
    hi = (low.hi + mid1.lo + mid2.lo) >>> 0;
  }
  return hex8(hi) + hex8(lo);
}

// 32x32 -> 64 unsigned multiply via 16-bit decomposition: a*b can exceed 2^53,
// so a direct JS product would lose precision.
function umul32(a: number, b: number): { hi: number; lo: number } {
  const aLo = a & 0xffff;
  const aHi = a >>> 16;
  const bLo = b & 0xffff;
  const bHi = b >>> 16;
  const p0 = aLo * bLo;
  const p1 = aHi * bLo;
  const p2 = aLo * bHi;
  const p3 = aHi * bHi;
  const carry = ((p0 >>> 16) + (p1 & 0xffff) + (p2 & 0xffff)) >>> 0;
  return {
    lo: ((p0 & 0xffff) | (carry << 16)) >>> 0,
    hi: (p3 + (p1 >>> 16) + (p2 >>> 16) + (carry >>> 16)) >>> 0,
  };
}

function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
