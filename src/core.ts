// QTH-512 v1.0 reference implementation. See SPEC.md.
// Internal module: everything is exported for tests and tooling. The public
// API is re-exported from src/qth512.ts, which is the only package entry.
//
//   leaves   SHA-512 over 4 MiB chunks (parallel)
//   lattice  Ring-SIS compression in Z_q[x]/(x^256 + 1), Merkle-Damgard chaining
//   final    SHAKE256
import { createHash } from 'node:crypto';

export const N = 256, Q = 12289, K = 32;
export const STATE_POLYS = 14, MSG_POLYS = K - STATE_POLYS;
export const BLOCK = (MSG_POLYS * N) / 8;   // 576 bytes
export const STATE_BYTES = (N * 14) / 8;    // 448 bytes
export const LEAF = 4 * 1024 * 1024;        // 4 MiB
export const DEFAULT_OUT = 64;

const te = new TextEncoder();
const shake = (outLength: number, ...parts: Uint8Array[]) => {
  const h = createHash('shake256', { outputLength: outLength });
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};
const le64 = (v: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; };

// ---------- NTT ----------
// Negacyclic NTT for fast ring multiplication. Output must match the schoolbook
// product in test/spec-check.ts.
const powmod = (b: number, e: number) => { let r = 1; b %= Q; while (e > 0) { if (e & 1) r = (r * b) % Q; b = (b * b) % Q; e >>= 1; } return r; };
const PSI = powmod(11, (Q - 1) / (2 * N)), PSI_INV = powmod(PSI, Q - 2);
const OMEGA = (PSI * PSI) % Q, OMEGA_INV = powmod(OMEGA, Q - 2), N_INV = powmod(N, Q - 2);
const psiPow = new Int32Array(N), psiInvPow = new Int32Array(N);
for (let i = 0, p = 1, pi = 1; i < N; i++) { psiPow[i] = p; psiInvPow[i] = (pi * N_INV) % Q; p = (p * PSI) % Q; pi = (pi * PSI_INV) % Q; }
const rev = new Int32Array(N);
for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < 8; b++) r |= ((i >> b) & 1) << (7 - b); rev[i] = r; }
const twiddles = (root: number) => {
  const t: Int32Array[] = [];
  for (let len = 2; len <= N; len <<= 1) {
    const w = powmod(root, N / len), a = new Int32Array(len / 2);
    for (let j = 0, x = 1; j < len / 2; j++) { a[j] = x; x = (x * w) % Q; }
    t.push(a);
  }
  return t;
};
const TW = twiddles(OMEGA), TW_INV = twiddles(OMEGA_INV);
function fft(a: Int32Array, t: Int32Array[]) {
  for (let i = 0; i < N; i++) if (i < rev[i]) { const x = a[i]; a[i] = a[rev[i]]; a[rev[i]] = x; }
  for (let s = 0, len = 2; len <= N; s++, len <<= 1) {
    const w = t[s], half = len >> 1;
    for (let i = 0; i < N; i += len) for (let j = 0; j < half; j++) {
      const u = a[i + j], v = (a[i + j + half] * w[j]) % Q;
      a[i + j] = u + v >= Q ? u + v - Q : u + v;
      a[i + j + half] = u - v < 0 ? u - v + Q : u - v;
    }
  }
}
const ntt = (a: Int32Array) => { for (let i = 0; i < N; i++) a[i] = (a[i] * psiPow[i]) % Q; fft(a, TW); };
const intt = (a: Int32Array) => { fft(a, TW_INV); for (let i = 0; i < N; i++) a[i] = (a[i] * psiInvPow[i]) % Q; };

// ---------- public constants (SPEC.md section 3) ----------
export function genA(): Int32Array[] {
  const raw = shake(K * N * 4, te.encode('QTH-512/A'));
  const out: Int32Array[] = []; let off = 0;
  for (let i = 0; i < K; i++) {
    const p = new Int32Array(N);
    for (let j = 0; j < N; ) {
      const x = (raw[off] | (raw[off + 1] << 8)) & 0x3fff; off += 2;
      if (x < Q) p[j++] = x;
    }
    out.push(p);
  }
  return out;
}
export const A = genA();
const A_HAT = A.map(p => { const c = p.slice(); ntt(c); return c; });
export const IV = shake(STATE_BYTES, te.encode('QTH-512/IV'));

// ---------- lattice layer (SPEC.md section 4) ----------
export function pack(s: Int32Array): Uint8Array {
  const out = new Uint8Array(STATE_BYTES); let bit = 0;
  for (let j = 0; j < N; j++) for (let b = 0; b < 14; b++, bit++) out[bit >> 3] |= ((s[j] >> b) & 1) << (bit & 7);
  return out;
}
// Reused scratch buffers. acc needs Float64: a sum of 32 products reaches
// 32 * (Q - 1)^2 ≈ 4.8e9, past Int32 but exact as a double.
const acc = new Float64Array(N), tmp = new Int32Array(N);
export function compress(state: Uint8Array, block: Uint8Array): Uint8Array {
  acc.fill(0);
  for (let i = 0; i < K; i++) {
    const src = i < STATE_POLYS ? state : block, base = (i < STATE_POLYS ? i : i - STATE_POLYS) * 32;
    for (let j = 0; j < N; j++) tmp[j] = (src[base + (j >> 3)] >> (j & 7)) & 1;
    ntt(tmp);
    const a = A_HAT[i];
    for (let j = 0; j < N; j++) acc[j] += a[j] * tmp[j];
  }
  const r = new Int32Array(N);
  for (let j = 0; j < N; j++) r[j] = acc[j] % Q;
  intt(r);
  return pack(r);
}
export function latticeChain(msg: Uint8Array): Uint8Array {
  const total = Math.ceil((msg.length + 9) / BLOCK) * BLOCK;
  const p = new Uint8Array(total);
  p.set(msg); p[msg.length] = 0x80;
  new DataView(p.buffer).setBigUint64(total - 8, BigInt(msg.length) * 8n, true);
  let s: Uint8Array = IV;
  for (let off = 0; off < total; off += BLOCK) s = compress(s, p.subarray(off, off + BLOCK));
  return s;
}

// ---------- leaves and final step (SPEC.md section 5) ----------
export const leafCount = (len: number) => Math.max(1, Math.ceil(len / LEAF));
const LEAF_TAG = te.encode('QTH-512/leaf'), FINAL_TAG = te.encode('QTH-512/final');
export const LEAF_BYTES = 64; // SHA-512
export function leafDigest(data: Uint8Array, i: number): Uint8Array {
  return new Uint8Array(createHash('sha512').update(LEAF_TAG).update(le64(i))
    .update(data.subarray(i * LEAF, Math.min((i + 1) * LEAF, data.length))).digest());
}
export function finish(leaves: Uint8Array[], len: number, outLen = DEFAULT_OUT): Uint8Array {
  const lb = LEAF_BYTES;
  const D = new Uint8Array(leaves.length * lb + 8);
  leaves.forEach((l, i) => D.set(l, i * lb));
  D.set(le64(len), leaves.length * lb);
  return shake(outLen, FINAL_TAG, latticeChain(D));
}

function checkOutLen(outLen: number) {
  if (!Number.isSafeInteger(outLen) || outLen < 1) throw new RangeError('QTH-512: outLen must be a positive integer (bytes)');
}

/**
 * Hashes bytes on the current thread. Same digest as `qth512Parallel`.
 * @param data   input bytes
 * @param outLen digest length in bytes (default 64)
 * @throws {TypeError}  if `data` is not a Uint8Array
 * @throws {RangeError} if `outLen` is not a positive integer
 */
export function qth512(data: Uint8Array, outLen = DEFAULT_OUT): Uint8Array {
  if (!(data instanceof Uint8Array)) throw new TypeError('qth512: data must be a Uint8Array or Buffer');
  checkOutLen(outLen);
  const leaves = Array.from({ length: leafCount(data.length) }, (_, i) => leafDigest(data, i));
  return finish(leaves, data.length, outLen);
}

// ---------- parallel mode (large inputs) ----------
const PARALLEL_THRESHOLD = 2 * LEAF;
type Job = { resolve: (out: Uint8Array) => void; reject: (err: Error) => void };
let pool: import('node:worker_threads').Worker[] | null = null;
const pending = new Map<number, Job>();
let nextJob = 0;

// Requests are tagged with an id that the worker echoes back, so concurrent calls
// cannot receive each other's results. Worker errors are posted back as messages
// rather than thrown, so a failed request rejects instead of hanging.
const workerSrc = `
const { parentPort } = require('node:worker_threads');
const { createHash } = require('node:crypto');
parentPort.on('message', ({ id, sab, len, from, to, leaf, alg, tag, lb }) => {
  try {
    const data = new Uint8Array(sab, 0, len), out = new Uint8Array((to - from) * lb), idx = Buffer.alloc(8);
    for (let i = from; i < to; i++) {
      idx.writeBigUInt64LE(BigInt(i));
      out.set(createHash(alg).update(tag).update(idx)
        .update(data.subarray(i * leaf, Math.min((i + 1) * leaf, len))).digest(), (i - from) * lb);
    }
    parentPort.postMessage({ id, out }, [out.buffer]);
  } catch (e) {
    parentPort.postMessage({ id, error: String(e && e.message || e) });
  }
});`;

function failPool(err: Error) {
  const dead = pool; pool = null;
  dead?.forEach(w => w.terminate());
  for (const job of pending.values()) job.reject(err);
  pending.clear();
}

async function getPool() {
  if (pool) return pool;
  const { Worker } = await import('node:worker_threads');
  const { cpus } = await import('node:os');
  if (pool) return pool;
  const workers = Array.from({ length: Math.max(1, cpus().length) }, () => {
    const w = new Worker(workerSrc, { eval: true });
    w.unref();
    w.on('message', ({ id, out, error }: { id: number; out?: Uint8Array; error?: string }) => {
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (error !== undefined || !out) job.reject(new Error(`QTH-512 worker: ${error}`));
      else job.resolve(out);
    });
    w.on('error', e => failPool(e instanceof Error ? e : new Error(String(e))));
    w.on('exit', code => { if (pool === workers) failPool(new Error(`QTH-512 worker exited with code ${code}`)); });
    return w;
  });
  return (pool = workers);
}

/**
 * Hashes the first `len` bytes of a SharedArrayBuffer across all CPU cores.
 * Inputs under 8 MiB are hashed on the current thread. Safe to call concurrently;
 * the buffer must not be modified until the promise settles.
 * @param sab    input data
 * @param len    number of bytes to hash (default: whole buffer)
 * @param outLen digest length in bytes (default 64)
 */
export async function qth512Parallel(sab: SharedArrayBuffer, len = sab?.byteLength, outLen = DEFAULT_OUT): Promise<Uint8Array> {
  if (!(sab instanceof SharedArrayBuffer)) throw new TypeError('qth512Parallel: sab must be a SharedArrayBuffer');
  if (!Number.isSafeInteger(len) || len < 0 || len > sab.byteLength)
    throw new RangeError(`qth512Parallel: len must be an integer from 0 to ${sab.byteLength}`);
  checkOutLen(outLen);
  if (len < PARALLEL_THRESHOLD) return qth512(new Uint8Array(sab, 0, len), outLen);
  const lb = LEAF_BYTES;
  const workers = await getPool();
  const leaves = leafCount(len), per = Math.ceil(leaves / workers.length);
  const parts = await Promise.all(workers.map((w, t) => {
    const from = t * per, to = Math.min(leaves, from + per);
    if (from >= to) return Promise.resolve(new Uint8Array(0));
    return new Promise<Uint8Array>((resolve, reject) => {
      const id = nextJob++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, sab, len, from, to, leaf: LEAF, alg: 'sha512', tag: 'QTH-512/leaf', lb });
    });
  }));
  const flat = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { flat.set(p, o); o += p.length; }
  if (flat.length !== leaves * lb) throw new Error('QTH-512 worker returned a wrong number of leaves');
  const list = Array.from({ length: leaves }, (_, i) => flat.subarray(i * lb, (i + 1) * lb));
  return finish(list, len, outLen);
}
export function closePool() {
  const dead = pool; pool = null;
  dead?.forEach(w => w.terminate());
  for (const job of pending.values()) job.reject(new Error('QTH-512 worker pool closed'));
  pending.clear();
}

export const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// ---------- convenience API ----------
/**
 * Hashes a string (UTF-8) or bytes.
 * @returns the digest as lowercase hex
 */
export function qth512Hex(input: string | Uint8Array, outLen = DEFAULT_OUT): string {
  const data = typeof input === 'string' ? te.encode(input) : input;
  return toHex(qth512(data, outLen));
}

/**
 * Hashes a file. Files of 8 MiB or more are hashed across all CPU cores.
 * @returns the digest as lowercase hex
 */
export async function qth512File(path: string, outLen = DEFAULT_OUT): Promise<string> {
  checkOutLen(outLen);
  const { open } = await import('node:fs/promises');
  const fh = await open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    if (size < PARALLEL_THRESHOLD) return toHex(qth512(new Uint8Array(await fh.readFile()), outLen));
    // Read directly into shared memory to avoid a second copy of the file.
    const sab = new SharedArrayBuffer(size), view = new Uint8Array(sab);
    let len = 0;
    while (len < size) {
      const { bytesRead } = await fh.read(view, len, Math.min(LEAF, size - len), len);
      if (bytesRead === 0) break; // file truncated during read: hash what was read
      len += bytesRead;
    }
    return toHex(await qth512Parallel(sab, len, outLen));
  } finally {
    await fh.close();
  }
}
