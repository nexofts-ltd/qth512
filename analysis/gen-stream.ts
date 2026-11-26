// Counter-mode stream QTH-512(LE64(0)) || QTH-512(LE64(1)) || ... for the statistical tests.
// Usage: bun analysis/gen-stream.ts <bytes> <file>
import { writeFileSync } from 'node:fs';
import { qth512 } from '../src/qth512.ts';
const bytes = Number(process.argv[2] ?? 12500000), file = process.argv[3] ?? 'stream.bin';
const out = new Uint8Array(bytes); const ctr = new Uint8Array(8); const dv = new DataView(ctr.buffer);
for (let i = 0, o = 0; o < bytes; i++, o += 64) { dv.setBigUint64(0, BigInt(i), true); out.set(qth512(ctr).subarray(0, Math.min(64, bytes - o)), o); }
writeFileSync(file, out);
