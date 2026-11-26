// Strict avalanche test: flip one random input bit, record which output bits change.
// Each output bit should flip with probability 1/2. Usage: bun analysis/avalanche.ts [trials]
import { randomBytes, randomInt } from 'node:crypto';
import { qth512 } from '../src/qth512.ts';

const trials = Number(process.argv[2] ?? 20000), perBit = new Float64Array(512);
let total = 0, minD = 512, maxD = 0;
for (let t = 0; t < trials; t++) {
  const m = randomBytes(64), h1 = qth512(m), b = randomInt(512);
  m[b >> 3] ^= 1 << (b & 7);
  const h2 = qth512(m); let d = 0;
  for (let i = 0; i < 512; i++) if (((h1[i >> 3] ^ h2[i >> 3]) >> (i & 7)) & 1) { perBit[i]++; d++; }
  total += d; minD = Math.min(minD, d); maxD = Math.max(maxD, d);
}
const sd = Math.sqrt(0.25 / trials);
const worst = Math.max(...Array.from(perBit, c => Math.abs(c / trials - 0.5)));
console.log(`${trials} trials: mean ${(total / trials / 512 * 100).toFixed(2)}% of bits flip | range ${minD}-${maxD} of 512`);
console.log(`most biased output bit: ${((0.5 + worst) * 100).toFixed(2)}% (${(worst / sd).toFixed(2)} sigma; ~3 sigma expected for 512 bits)`);
