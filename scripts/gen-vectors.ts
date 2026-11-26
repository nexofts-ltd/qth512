// Regenerates test/test-vectors.json. Each vector is computed by the NTT reference,
// the schoolbook implementation (test/spec-check.ts) and parallel mode; all three must agree.
import { writeFileSync } from 'node:fs';
import { qth512, qth512Parallel, closePool, A, IV, toHex, latticeChain, leafDigest } from '../src/core.ts';
import { qthSpec, specA, specIV } from '../test/spec-check.ts';

const pattern = (n: number) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = i % 251; return b; };
const MiB = 1048576;

export const CASES: { name: string; desc: string; data: () => Buffer; outLen?: number }[] = [
  { name: 'empty', desc: 'empty string', data: () => Buffer.alloc(0) },
  { name: 'abc', desc: 'ASCII "abc"', data: () => Buffer.from('abc') },
  { name: 'abc-32', desc: 'ASCII "abc", 32-byte output', data: () => Buffer.from('abc'), outLen: 32 },
  { name: 'hello-naim', desc: 'ASCII "hello naim"', data: () => Buffer.from('hello naim') },
  { name: 'million-a', desc: '1,000,000 × "a"', data: () => Buffer.alloc(1_000_000, 'a') },
  { name: 'leaf-exact', desc: 'pattern(4 MiB), exactly 1 leaf', data: () => pattern(4 * MiB) },
  { name: 'leaf-plus-1', desc: 'pattern(4 MiB + 1), 2 leaves', data: () => pattern(4 * MiB + 1) },
  { name: 'block-8', desc: 'pattern(32 MiB), 8 leaves, D fits in 1 lattice block', data: () => pattern(32 * MiB) },
  { name: 'block-9', desc: 'pattern(32 MiB + 1), 9 leaves, D needs 2 lattice blocks', data: () => pattern(32 * MiB + 1) },
];

const aOk = A.every((p, i) => p.every((v, j) => v === specA[i][j]));
const ivOk = Buffer.from(IV).equals(specIV);
console.log(`A matrix: ${aOk ? 'ok' : 'MISMATCH'}, IV: ${ivOk ? 'ok' : 'MISMATCH'}`);

const vectors: any[] = []; let allOk = aOk && ivOk;
for (const c of CASES) {
  const m = c.data(), out = c.outLen ?? 64;
  const ref = qth512(m, out), spec = qthSpec(m, out);
  const sab = new SharedArrayBuffer(m.length || 1); new Uint8Array(sab).set(m);
  const par = await qth512Parallel(sab, m.length, out);
  const ok = Buffer.from(ref).equals(spec.H) && Buffer.from(par).equals(spec.H);
  allOk &&= ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(12)} ${toHex(ref).slice(0, 32)}...`);
  vectors.push({ name: c.name, description: c.desc, length: m.length, outLen: out,
    ...(m.length <= 64 ? { inputHex: m.toString('hex') } : {}), leaves: spec.leaves.length, digest: toHex(ref) });
}
closePool();

const abc = qthSpec(Buffer.from('abc'));
const intermediates = {
  input: 'abc',
  A0_first8: Array.from(A[0].slice(0, 8)), A31_last8: Array.from(A[31].slice(248)),
  IV: toHex(IV),
  leaf0: toHex(leafDigest(Buffer.from('abc'), 0)),
  D: abc.D.toString('hex'),
  latticeState: toHex(latticeChain(abc.D)),
  digest: abc.H.toString('hex'),
};
allOk &&= intermediates.latticeState === abc.S.toString('hex');

writeFileSync(new URL('../test/test-vectors.json', import.meta.url), JSON.stringify({
  algorithm: 'QTH-512', version: '1.0',
  patternDefinition: 'pattern(n): byte i = i mod 251, for i = 0..n-1',
  vectors, intermediates,
}, null, 2) + '\n');
console.log(allOk ? '\nAll vectors match.' : '\nSome vectors do not match.');
if (!allOk) process.exit(1);
