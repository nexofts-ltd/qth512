// Throughput: 512 MB parallel, 64 MB single-threaded, 1 KB messages.
import { cpus } from 'node:os';
import { qth512, qth512Parallel, closePool } from '../src/qth512.ts';

const MB = 1048576;
const big = new SharedArrayBuffer(512 * MB);
await qth512Parallel(big, 32 * MB); // warm-up: start worker threads

let best = Infinity;
for (let r = 0; r < 3; r++) { const t = performance.now(); await qth512Parallel(big); best = Math.min(best, performance.now() - t); }
console.log(`CPU: ${cpus()[0].model} × ${cpus().length}`);
console.log(`512 MB, parallel     : ${(512 / (best / 1000)).toFixed(0)} MB/s`);

const single = new Uint8Array(64 * MB);
let t = performance.now(); qth512(single);
console.log(`64 MB, single thread : ${(64 / ((performance.now() - t) / 1000)).toFixed(0)} MB/s`);

const msg = new Uint8Array(1024); const n = 3000;
t = performance.now(); for (let i = 0; i < n; i++) qth512(msg);
const us = (performance.now() - t) * 1000 / n;
console.log(`1 KB message         : ${us.toFixed(0)} µs/hash (${(1e6 / us).toFixed(0)} hashes/s)`);
closePool();
