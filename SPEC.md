# QTH-512 v1.0

Quantum-safe Tree Hash · Version 1.0 · 2026-11-27 · Nexofts Ltd

## 1. Overview

QTH-512 maps a byte string of arbitrary length to a 64-byte digest. Its one-wayness rests on a Ring-SIS lattice layer, so the construction remains one-way even if SHA-512 is broken.

The construction has three layers:

1. **Leaf layer.** The input is split into 4 MiB chunks, and each chunk is hashed with domain-separated SHA-512. Chunks are independent and may be processed in parallel.
2. **Lattice layer.** A Ring-SIS compression function over Z_Q[x]/(x^256 + 1), iterated in Merkle–Damgård mode, absorbs the leaf digests.
3. **Final layer.** SHAKE256 maps the 448-byte lattice state to the output and removes the linearity of the lattice layer.

Design goals:

- 256-bit classical resistance to preimage, second-preimage and collision attacks.
- One-wayness based on a lattice problem with no known quantum speed-up beyond generic search.
- Throughput on large inputs that scales with the number of cores.
- A description complete enough to reimplement QTH-512 from this document alone.

QTH-512 has not been analysed by third parties. It is intended for research and evaluation, not for protecting production data.

## 2. Notation and parameters

Integers are encoded little-endian. Bits are numbered LSB-first: bit j of a byte string B is `(B[j >> 3] >> (j & 7)) & 1`. `||` denotes concatenation, and LE64(v) denotes v encoded as 8 little-endian bytes. All strings are ASCII.

| Symbol | Value | Meaning |
| --- | --- | --- |
| N | 256 | Ring degree |
| Q | 12289 | Modulus, prime, Q ≡ 1 (mod 512) |
| R_Q | Z_Q[x]/(x^256 + 1) | Ring of the lattice layer |
| K | 32 | Ring elements per compression call |
| S | 14 | Ring elements taken from the chaining state |
| STATE_BYTES | 448 | Chaining state size (256 × 14 bits) |
| BLOCK | 576 | Message bytes per compression call ((K − S) × 256 / 8) |
| LEAF | 4 194 304 | Leaf chunk size in bytes (4 MiB) |
| H_leaf | SHA-512 | Leaf hash, 64-byte digests |
| OUT | 64 | Default output length in bytes (512 bits) |

## 3. Public constants

Both constants are derived from SHAKE256 with fixed labels. Because they are not chosen by hand, they cannot hide a trapdoor.

**3.1 Matrix A.** A is a vector of K = 32 ring elements a_0 … a_31, each with 256 coefficients in [0, Q).

1. Let R = SHAKE256("QTH-512/A", 32768 bytes).
2. Read R as consecutive 16-bit little-endian words w, and let v = w & 0x3FFF.
3. If v < Q, accept v as the next coefficient; otherwise discard it.
4. Fill a_0 from coefficient 0 to 255, then a_1, and so on through a_31.

Sampling ends at byte 21 830 of R.

**3.2 IV.** IV = SHAKE256("QTH-512/IV", 448 bytes). It is the initial chaining state.

## 4. Lattice layer

The lattice layer L absorbs a byte string in 576-byte blocks and returns a 448-byte state.

**4.1 Binary ring elements.** A 32-byte string b decodes to the ring element x whose coefficient j is bit j of b (LSB-first), for j = 0 … 255.

**4.2 Compression C(state, block).** Concatenate the 448-byte state and the 576-byte block into 1024 bytes. Decode 32 binary ring elements x_0 … x_31 from consecutive 32-byte slices, so that x_0 … x_13 come from the state and x_14 … x_31 from the block. Compute

    y = Σ_{i=0}^{31} a_i · x_i   in R_Q = Z_Q[x]/(x^256 + 1)

Multiplication is negacyclic (x^256 = −1). Each coefficient of y is reduced to [0, Q).

**4.3 Packing.** The 256 coefficients of y are written as 14-bit values into a single bit stream, coefficient 0 first and each value LSB-first. The resulting 3584 bits fill exactly 448 bytes, which form the new state.

**4.4 Chaining L(M).**

1. Pad: P = M || 0x80 || zero bytes || LE64(8 × |M|), where the number of zero bytes makes |P| the smallest multiple of 576 that holds M plus 9 bytes.
2. Set s = IV.
3. For each 576-byte block P_k in order, set s = C(s, P_k).
4. Return s.

Each compression call maps 8192 input bits to 3584 output bits. A collision or preimage for C yields a short ({−1, 0, 1} or binary) solution to a Ring-SIS instance.

## 5. Algorithm

QTH-512(M, OUT), for a byte string M and an output length OUT in bytes (default 64):

1. **Leaves.** Let n = max(1, ⌈|M| / LEAF⌉). Chunk M_i consists of bytes i × LEAF up to (i + 1) × LEAF of M. The last chunk may be shorter, and the empty input has one empty chunk.
2. For i = 0 … n − 1, compute h_i = SHA-512("QTH-512/leaf" || LE64(i) || M_i), a 64-byte digest.
3. **Digest string.** D = h_0 || h_1 || … || h_(n−1) || LE64(|M|), where |M| is the length in bytes.
4. **Lattice.** S = L(D), as defined in section 4.4.
5. **Final.** Output SHAKE256("QTH-512/final" || S, OUT bytes).

```
Input M ──► chunks M_0 … M_n−1 ──► SHA-512 leaves h_0 … h_n−1     (parallel)
        ──► D = h_0 ‖ … ‖ h_n−1 ‖ LE64(|M|)
        ──► S = L(D)  Ring-SIS lattice, 576-byte blocks from IV
        ──► SHAKE256("QTH-512/final" ‖ S) ──► 64-byte digest
```

The leaf index in step 2 prevents chunk reordering. The length in step 3 separates inputs that share the same leaves but differ in length. As with any SHAKE output, shorter digests are prefixes of longer ones. Applications that need independent outputs of different lengths must include their own label in M.

## 6. Security

### 6.1 Claims

| Property | Classical | Quantum | Required break |
| --- | --- | --- | --- |
| Preimage (one-way) | 256 bits | ≥ 128 bits | SHAKE256, the lattice layer and SHA-512, in sequence |
| Second preimage | 256 bits | ≥ 128 bits | Any one layer (a second preimage of one leaf suffices) |
| Collision | 256 bits | ≥ 170 bits | Any one layer |

The quantum collision figure is the Brassard–Høyer–Tapp bound of 2^(n/3) for an n-bit hash. That attack requires quantum memory of comparable size, so on realistic hardware the classical figure is the relevant one. The figures are design targets supported by estimates, not proofs.

**One-wayness across layers.** Inverting QTH-512 requires a state S that SHAKE256 maps to the output, then a string D that L maps to S, then chunks whose SHA-512 leaves form D. Each step is an independent preimage problem. This argument is heuristic; no formal reduction is claimed.

**Quantum attacks.** Shor's algorithm requires group structure, which none of the three layers has. Grover's search gives at most a square-root speed-up.

### 6.2 Lattice layer estimate

A collision in one compression call is a nonzero v ∈ {−1, 0, 1}^8192 with A·v = 0 (mod Q) over 256 equations. The model in `analysis/estimate.py` favours the attacker: it counts any short vector found by lattice reduction as a success, even when that vector is not ternary.

| Attack on the lattice layer | Estimated cost |
| --- | --- |
| BKZ lattice reduction, block size 1683, classical (core-SVP 0.292β) | 2^491 |
| Same, quantum (core-SVP 0.265β) | 2^446 |
| Generalised birthday (Wagner k-tree, best k = 16) | 2^700 |
| Generic birthday on the 3478-bit output | 2^1739 |

Under this model the lattice layer exceeds the 256-bit target by at least 190 bits.

### 6.3 Statistical tests

Eight core tests from NIST SP 800-22 rev1a were run on 100 sequences of 1 000 000 bits of counter-mode output, QTH-512(LE64(i)) (`analysis/stat_tests.py`). A test passes when at least 97 of 100 sequences pass at α = 0.01 and the p-values are uniform (P ≥ 0.0001).

| Test | QTH-512 | os.urandom (control) |
| --- | --- | --- |
| Frequency (monobit) | 97/100 | 98/100 |
| Block frequency | 98/100 | 100/100 |
| Runs | 98/100 | 97/100 |
| Longest run of ones | 99/100 | 99/100 |
| Spectral (DFT) | 98/100 | 100/100 |
| Serial (m = 10) | 98/100 | 99/100 |
| Approximate entropy (m = 10) | 98/100 | 98/100 |
| Cumulative sums | 98/100 | 98/100 |

Both pass every test. A weak LCG used as a negative control fails 4 of the 8, which confirms that the harness detects bias.

A strict-avalanche test (`analysis/avalanche.ts`) flipped one random input bit in each of 20 000 trials. On average 50.01% of output bits changed, and the most biased output bit was 2.6 standard deviations from 50%, consistent with 512 independent random bits. Inputs are random, so repeated runs give slightly different figures.

### 6.4 Limitations

- The lattice layer is linear over bit strings, as in SWIFFT, and is not a random oracle on its own. The SHAKE256 layer removes this structure from the output.
- The security figures are the authors' estimates and have not been independently verified.
- Passing statistical tests shows an absence of detectable bias. It does not establish security.
- The reference implementation is not constant-time and must not be used to hash secret low-entropy data such as passwords.

## 7. Implementation notes

**NTT.** Since Q ≡ 1 (mod 512), R_Q admits a negacyclic number-theoretic transform. With ψ = 11^24 mod Q, a primitive 512th root of unity, each product a_i · x_i costs O(N log N) instead of O(N²). The reference implementation stores the a_i in NTT form. Any method that computes the ring product of section 4.2 gives the same output; `test/spec-check.ts` uses schoolbook multiplication.

**Parallel mode.** Because leaves are independent, `qth512Parallel` distributes them across worker threads that share a SharedArrayBuffer. Inputs under 8 MiB use the single-thread path. Both paths produce identical digests.

**Performance** (`bench/bench.ts`, Intel Xeon 2.3 GHz, 2 cores, Bun 1.4):

| Workload | Result |
| --- | --- |
| 512 MB, parallel mode | 1337 MB/s |
| 64 MB, single thread | 635 MB/s |
| 1 KB message | 290 µs per hash (about 3 400 hashes/s) |

SHA-512 dominates the cost of large inputs, so throughput scales with core count. The lattice layer dominates the cost of small inputs.

## 8. Test vectors

Every vector below is produced identically by three implementations: the NTT reference, an independent schoolbook implementation written from this document, and the parallel mode. pattern(n) denotes n bytes with byte i = i mod 251. Machine-readable copies are in `test/test-vectors.json`.

| Name | Input | Bytes | Leaves | QTH-512 digest (hex) |
| --- | --- | --- | --- | --- |
| empty | "" | 0 | 1 | `1fbad266ae5f92b4a15b5160d40299a8f498a7ee2ce9d6980d5d84c591d9461d55527f3083bda10ba01c29d167908775060186c433d5f3f98437f7257b221a8e` |
| abc | "abc" | 3 | 1 | `8de4f531e7217aff4c6913c147a5fed3b8e91f608f026eb393749f95717df750f9d00dd4c6c9ddb0eeb1eac325150bb195035a56e665b8b4abe5860c568f55a2` |
| abc-32 | "abc", OUT = 32 | 3 | 1 | `8de4f531e7217aff4c6913c147a5fed3b8e91f608f026eb393749f95717df750` |
| hello-naim | "hello naim" | 10 | 1 | `b0d77502544df6e9f47e3551c957cf2b4df76ea0b79cd3f983f24a06a8880ff660ed993a4741e97fe260268a61f627179df418f23c7a7f16cacab464527a25a4` |
| million-a | 1 000 000 × "a" | 1 000 000 | 1 | `c09fca7f2ed88396b6931716591d9c27b49eda450c36222f646d0c48b9455a0c7262b7063ecf4be487ee8ee278b2c385d0dc5a987e21302b6b1ae1b310029b92` |
| leaf-exact | pattern(4 MiB) | 4 194 304 | 1 | `7a7600fda5e31a2c08b4f62ce47b62901596035bf566220f41bc9ac16b6d364255dca4b7261a6acc7b3b0697c6a99e503447a15457da94e100c43a55be22a1c1` |
| leaf-plus-1 | pattern(4 MiB + 1) | 4 194 305 | 2 | `c45f2f14bb588d5afd33fa8e68b14ebd9fa6c0bbfe5aab3b198df84536a270cc173b4aa18c21dbeda348a56d2d11fee82955229b2a4d7b1506b88dfbc1f674a5` |
| block-8 | pattern(32 MiB) | 33 554 432 | 8 | `f3ed1f121b72262d44f00d8508e19abc55a800198623d04e886a7a8f913a1f387a749a2e4381bf2f321499e33af7104054c9c3506858949d70444b45e5d97f65` |
| block-9 | pattern(32 MiB + 1) | 33 554 433 | 9 | `c76eb4124aa437fde0b69325007e63393908b0c78811bfd180edae2285de8c9bdfa1435830b7a38744016d0c06b7eefe8dcf20755bc65843c4a4d33f27186be6` |

block-8 and block-9 cover the padding boundary of the lattice layer: D is 520 bytes (one block) for 8 leaves and 584 bytes (two blocks) for 9.

**Intermediate values for "abc":**

- a_0, first 8 coefficients: 5406, 1473, 2612, 10758, 7068, 2810, 12250, 3527
- a_31, last 8 coefficients: 1954, 10238, 416, 6232, 3275, 2391, 668, 2982
- h_0: `6f607098c5796fcbcfd14677a03cdac733c3bfad0e85b8c2e30c0464e2cb671007605b13b77c92cb080f6c725dd895f173285ad6860a780e9034d41c64cf427c`
- D: `6f607098c5796fcbcfd14677a03cdac733c3bfad0e85b8c2e30c0464e2cb671007605b13b77c92cb080f6c725dd895f173285ad6860a780e9034d41c64cf427c0300000000000000`
- IV and S = L(D), 448 bytes each: see `intermediates` in `test/test-vectors.json`.
