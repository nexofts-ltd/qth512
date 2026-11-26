// Independent QTH-512 implementation, written from SPEC.md only.
// Schoolbook negacyclic multiplication, no NTT, no code shared with src/core.ts.
// Used by the tests and scripts/gen-vectors.ts to cross-check the reference.
import { createHash } from 'node:crypto';

const N = 256, Q = 12289, K = 32, LEAF = 4194304;
const enc = (s: string) => Buffer.from(s, 'utf8');
const shake = (n: number, ...p: Buffer[]) => { const h = createHash('shake256', { outputLength: n }); p.forEach(x => h.update(x)); return h.digest(); };
const u64 = (v: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };

// Section 3.1: matrix A
const stream = shake(32768, enc('QTH-512/A'));
const A: number[][] = [];
{ let off = 0; for (let i = 0; i < K; i++) { const p: number[] = []; while (p.length < N) { const v = stream.readUInt16LE(off) & 0x3fff; off += 2; if (v < Q) p.push(v); } A.push(p); } }
// Section 3.2: IV
const IV = shake(448, enc('QTH-512/IV'));

const bitsOf = (buf: Buffer, polyIndex: number) => { const x: number[] = []; for (let j = 0; j < N; j++) { const bit = polyIndex * N + j; x.push((buf[bit >> 3] >> (bit & 7)) & 1); } return x; };

// Section 4.2: compression, y = sum of a_i * x_i in Z_q[x]/(x^N + 1)
function compress(state: Buffer, block: Buffer): Buffer {
  const y = new Array<number>(N).fill(0);
  for (let i = 0; i < K; i++) {
    const x = i < 14 ? bitsOf(state, i) : bitsOf(block, i - 14);
    for (let j = 0; j < N; j++) if (x[j]) for (let t = 0; t < N; t++) {
      const k = j + t; if (k < N) y[k] += A[i][t]; else y[k - N] -= A[i][t];
    }
  }
  const out = Buffer.alloc(448); // Section 4.3: 14 bits per coefficient, LSB-first
  for (let j = 0; j < N; j++) { const c = ((y[j] % Q) + Q) % Q; for (let b = 0; b < 14; b++) { const bit = j * 14 + b; out[bit >> 3] |= ((c >> b) & 1) << (bit & 7); } }
  return out;
}
// Section 4.4: padding and Merkle-Damgard chaining
export function L(msg: Buffer): Buffer {
  const total = Math.ceil((msg.length + 9) / 576) * 576;
  const p = Buffer.alloc(total); msg.copy(p); p[msg.length] = 0x80; p.writeBigUInt64LE(BigInt(msg.length * 8), total - 8);
  let s: Buffer = IV; for (let o = 0; o < total; o += 576) s = compress(s, p.subarray(o, o + 576)); return s;
}
// Section 5: leaves, digest string, lattice, SHAKE256
export function qthSpec(m: Buffer, outLen = 64) {
  const name = 'QTH-512', alg = 'sha512';
  const n = Math.max(1, Math.ceil(m.length / LEAF));
  const leaves: Buffer[] = [];
  for (let i = 0; i < n; i++) leaves.push(createHash(alg).update(enc(name + '/leaf')).update(u64(i)).update(m.subarray(i * LEAF, (i + 1) * LEAF)).digest());
  const D = Buffer.concat([...leaves, u64(m.length)]);
  const S = L(D);
  return { leaves, D, S, H: shake(outLen, enc(name + '/final'), S) };
}
export const specA = A, specIV = IV;
