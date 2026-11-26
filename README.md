# QTH-512

[![CI](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

A 512-bit hash function with a lattice-based core, built to stay one-way against quantum attacks.

```ts
import { qth512Hex, qth512File } from 'qth512';

qth512Hex('abc');               // '8de4f531e7217aff4c6913c147a5fed3…'
await qth512File('backup.iso'); // big files are hashed on every CPU core
```

## How it works

Your data goes through three layers:

1. **SHA-512** hashes it in 4 MiB chunks, all CPU cores at once.
2. A **Ring-SIS lattice** layer compresses those chunk hashes. Lattice problems like this have no known quantum shortcut.
3. **SHAKE256** turns the result into the final digest.

To reverse a digest, an attacker has to break all three, one after another.

| | Classical | Quantum |
| --- | --- | --- |
| Preimage | 256-bit | ≥ 128-bit |
| Collision | 256-bit | ≥ 170-bit |
| Lattice layer alone (estimate) | 2^491 | 2^446 |

The full design, security analysis and test vectors are in [SPEC.md](SPEC.md).

> [!NOTE]
> QTH-512 is a research hash. It hasn't been independently cryptanalysed, so for production data stick with SHA-2 or SHA-3. See [SECURITY.md](SECURITY.md).

## Install

Works on Node.js 20+ and [Bun](https://bun.sh) 1.1+. ESM only, TypeScript types included.

```sh
npm install qth512
# or
bun add qth512
```

## Usage

```ts
import { qth512Hex, qth512File } from 'qth512';

qth512Hex('hello');                  // string in, hex out
qth512Hex(new Uint8Array([1, 2, 3])); // bytes work too
qth512Hex('hello', 32);              // shorter digest (32 bytes)
await qth512File('video.mp4');       // any file size
```

Need raw bytes instead of hex?

```ts
import { qth512, qth512Parallel } from 'qth512';

qth512(bytes);                       // Uint8Array → Uint8Array
await qth512Parallel(sharedBuffer);  // same digest, multi-core
```

Don't use QTH-512 for passwords. It's fast by design, which is exactly what you don't want there. Use Argon2 or bcrypt instead.

## Performance

2-core Intel Xeon at 2.3 GHz, Bun 1.4:

| Workload | Speed |
| --- | --- |
| 512 MB, parallel | 1337 MB/s |
| 64 MB, single thread | 635 MB/s |
| 1 KB message | 290 µs per hash |

More cores, faster big files.

## Development

```sh
bun test            # unit tests and test vectors
bun run build       # compile src/ to dist/ (JS + .d.ts)
bun run test:node   # check the built package on Node.js
bun run vectors     # rebuild test/test-vectors.json, cross-checked three ways
bun run bench       # benchmark
bun run avalanche   # avalanche test
bun run estimate    # lattice security estimate (Python 3)
bun run stats       # NIST SP 800-22 tests (Python 3, numpy, scipy)
```

| Path | What's there |
| --- | --- |
| `src/qth512.ts` | Public API (the package entry) |
| `src/core.ts` | The implementation; compiled with it to `dist/` for npm |
| `test/` | Unit tests, test vectors, and a second implementation written only from SPEC.md |
| `scripts/` | Test vector generator |
| `analysis/` | Security estimate, statistical and avalanche tests |
| `bench/` | Benchmark |

### Releasing

1. Bump the version: `npm version patch` (or `minor` / `major`) and update `CHANGELOG.md`.
2. Push the commit and tag: `git push --follow-tags`.
3. Publish a GitHub release for the tag. The Release workflow tests, builds and publishes to npm with provenance.

Found a weakness or wrote a port in another language? Open an issue, we'd love to hear about it.

## License

[MIT](LICENSE) © 2026 Nexofts Ltd
