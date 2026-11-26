import { describe, expect, test, afterAll } from 'bun:test';
import { qth512, qth512Parallel, qth512Hex, qth512File, closePool, toHex, latticeChain, IV } from '../src/core.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qthSpec } from './spec-check.ts';
import vectors from './test-vectors.json';

const pattern = (n: number) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = i % 251; return b; };
const inputs: Record<string, () => Buffer> = {
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

afterAll(() => closePool());

describe('known-answer vectors', () => {
  for (const v of vectors.vectors) {
    test(v.name, () => {
      const m = inputs[v.name]();
      expect(m.length).toBe(v.length);
      expect(toHex(qth512(m, v.outLen))).toBe(v.digest);
    });
  }
});

describe('intermediates for "abc"', () => {
  const i = vectors.intermediates;
  test('IV', () => expect(toHex(IV)).toBe(i.IV));
  test('lattice state', () => expect(toHex(latticeChain(Buffer.from(i.D, 'hex')))).toBe(i.latticeState));
});

describe('independent spec implementation agrees', () => {
  for (const n of [0, 1, 63, 64, 567, 568, 1000, 5000]) {
    test(`random ${n} bytes`, () => {
      const m = Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
      expect(toHex(qth512(m))).toBe(qthSpec(m).H.toString('hex'));
    });
  }
});

describe('parallel mode', () => {
  test('matches single-thread on 9 leaves', async () => {
    const m = pattern(32 * 1048576 + 1);
    const sab = new SharedArrayBuffer(m.length); new Uint8Array(sab).set(m);
    expect(toHex(await qth512Parallel(sab))).toBe(toHex(qth512(m)));
  });
});

describe('basic properties', () => {
  test('output length', () => {
    for (const n of [1, 16, 32, 64, 128]) expect(qth512(Buffer.from('x'), n).length).toBe(n);
  });
  test('one-bit change flips about half the output bits', () => {
    let total = 0;
    for (let t = 0; t < 200; t++) {
      const m = Buffer.from(crypto.getRandomValues(new Uint8Array(64)));
      const h1 = qth512(m); m[t % 64] ^= 1 << (t % 8); const h2 = qth512(m);
      for (let i = 0; i < 64; i++) { let x = h1[i] ^ h2[i]; while (x) { total += x & 1; x >>= 1; } }
    }
    const rate = total / (200 * 512);
    expect(rate).toBeGreaterThan(0.47);
    expect(rate).toBeLessThan(0.53);
  });
});

describe('parallel mode robustness', () => {
  const sabOf = (n: number, seed: number) => {
    const sab = new SharedArrayBuffer(n), u = new Uint8Array(sab);
    for (let i = 0; i < n; i++) u[i] = (i * 7 + seed) & 255;
    return sab;
  };
  test('concurrent calls each get their own digest', async () => {
    const bufs = [sabOf(9 * 1048576, 1), sabOf(12 * 1048576 + 5, 2), sabOf(17 * 1048576, 3)];
    const got = await Promise.all(bufs.map(b => qth512Parallel(b)));
    bufs.forEach((b, i) => expect(toHex(got[i])).toBe(toHex(qth512(new Uint8Array(b)))));
  });
  test('len shorter than the buffer hashes only the prefix', async () => {
    const sab = sabOf(10 * 1048576, 4), len = 9 * 1048576 + 3;
    expect(toHex(await qth512Parallel(sab, len))).toBe(toHex(qth512(new Uint8Array(sab, 0, len))));
  });
  test('bad arguments reject instead of hanging', async () => {
    const sab = sabOf(9 * 1048576, 5);
    await expect(qth512Parallel(sab, sab.byteLength + 1)).rejects.toThrow(RangeError);
    await expect(qth512Parallel(sab, -1)).rejects.toThrow(RangeError);
    await expect(qth512Parallel(sab, 1.5)).rejects.toThrow(RangeError);
    await expect(qth512Parallel(new ArrayBuffer(8) as any)).rejects.toThrow(TypeError);
    await expect(qth512Parallel(sab, undefined, 0)).rejects.toThrow(RangeError);
  });
  test('pool still works after closePool()', async () => {
    const sab = sabOf(9 * 1048576, 6);
    closePool();
    expect(toHex(await qth512Parallel(sab))).toBe(toHex(qth512(new Uint8Array(sab))));
  });
});

describe('input validation', () => {
  test('rejects non-byte input', () => {
    expect(() => qth512('abc' as any)).toThrow(TypeError);
    expect(() => qth512([1, 2, 3] as any)).toThrow(TypeError);
  });
  test('rejects bad output lengths', () => {
    for (const n of [0, -1, 1.5, NaN, Infinity]) expect(() => qth512(Buffer.from('x'), n)).toThrow(RangeError);
  });
});

describe('convenience API', () => {
  test('qth512Hex accepts strings and bytes', () => {
    expect(qth512Hex('abc')).toBe(toHex(qth512(Buffer.from('abc'))));
    expect(qth512Hex(Buffer.from('abc'), 32)).toBe(toHex(qth512(Buffer.from('abc'), 32)));
    expect(qth512Hex('héllo')).toBe(toHex(qth512(Buffer.from('héllo', 'utf8'))));
  });
  test('qth512File matches qth512 for small and large files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qth512-'));
    try {
      for (const n of [0, 11, 9 * 1048576 + 7]) {
        const m = pattern(n), p = join(dir, `f${n}`);
        writeFileSync(p, m);
        expect(await qth512File(p)).toBe(toHex(qth512(m)));
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  test('qth512File rejects a missing file', async () => {
    await expect(qth512File('/nonexistent/qth512-test')).rejects.toThrow();
  });
});
