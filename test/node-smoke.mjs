// Checks the built package (dist/) under plain Node.js, the way npm users get it.
// Run with: npm run build && node test/node-smoke.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qth512, qth512Hex, qth512File, qth512Parallel, closePool, toHex } from 'qth512';

// The package must expose only the public API, not internals like N or compress.
const api = Object.keys(await import('qth512')).sort();
assert.deepEqual(api, ['closePool', 'qth512', 'qth512File', 'qth512Hex', 'qth512Parallel', 'toHex'], 'public exports');

const vectors = JSON.parse(readFileSync(new URL('./test-vectors.json', import.meta.url), 'utf8'));
const pattern = (n) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = i % 251; return b; };
const inputs = {
  'empty': () => Buffer.alloc(0),
  'abc': () => Buffer.from('abc'),
  'abc-32': () => Buffer.from('abc'),
  'hello-naim': () => Buffer.from('hello naim'),
  'million-a': () => Buffer.alloc(1_000_000, 'a'),
  'leaf-exact': () => pattern(4 * 1048576),
  'leaf-plus-1': () => pattern(4 * 1048576 + 1),
  'block-8': () => pattern(32 * 1048576),
  'block-9': () => pattern(32 * 1048576 + 1),
};

for (const v of vectors.vectors) {
  const make = inputs[v.name];
  assert.ok(make, `no input for vector ${v.name}`);
  const m = make();
  assert.equal(toHex(qth512(m, v.outLen)), v.digest, `vector ${v.name}`);
}

// Parallel path (worker threads) must match the single-thread digest.
const big = pattern(9 * 1048576);
const sab = new SharedArrayBuffer(big.length);
new Uint8Array(sab).set(big);
assert.equal(toHex(await qth512Parallel(sab)), toHex(qth512(big)), 'qth512Parallel');

const dir = mkdtempSync(join(tmpdir(), 'qth512-'));
try {
  const file = join(dir, 'big.bin');
  writeFileSync(file, big);
  assert.equal(await qth512File(file), qth512Hex(big), 'qth512File');
} finally {
  rmSync(dir, { recursive: true, force: true });
  closePool();
}

console.log(`node ${process.version}: ${vectors.vectors.length} vectors + parallel + file OK`);
