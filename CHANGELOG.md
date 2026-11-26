# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org).

## [1.0.1] - 2026-11-27

### Changed

- The package now exports only the public API: `qth512`, `qth512Parallel`, `qth512Hex`, `qth512File`, `closePool` and `toHex`. Internal constants and helpers (`N`, `Q`, `BLOCK`, `compress` and others) are no longer exposed. Digests are unchanged.

## [1.0.0] - 2026-11-27

### Added

- QTH-512 hash: SHA-512 leaves, Ring-SIS lattice layer, SHAKE256 output.
- `qth512Hex()` and `qth512File()`.
- `qth512()` and `qth512Parallel()` for raw bytes.
- Automatic multi-core hashing for inputs of 8 MiB and larger.
- Input validation with descriptive errors.
- Test vectors, cross-checked against an independent implementation.
- Lattice security estimate, NIST SP 800-22 tests and avalanche test.
- npm package: compiled ESM build in `dist/` with TypeScript declarations, for Node.js 20+ and Bun.
- CI and Dependabot; CI also tests the built package on Node 20, 22 and 24.
- Release workflow publishing to npm with provenance.
