"""Eight core NIST SP 800-22 rev1a tests, implemented with numpy and scipy.

Pass a positive control (os.urandom output) and a negative control (a weak generator)
alongside the QTH-512 stream to validate the harness itself.

Usage: python3 analysis/stat_tests.py stream.bin [control.bin ...]
"""
import sys
import numpy as np
from math import erfc, sqrt, log
from scipy.special import gammaincc
from scipy.stats import norm

ALPHA = 0.01

def monobit(b):
    s = np.sum(2 * b.astype(np.int64) - 1)
    return erfc(abs(s) / sqrt(len(b)) / sqrt(2))

def block_frequency(b, M=128):
    N = len(b) // M
    pi = b[:N * M].reshape(N, M).mean(axis=1)
    chi = 4 * M * np.sum((pi - 0.5) ** 2)
    return gammaincc(N / 2, chi / 2)

def runs(b):
    n = len(b); pi = b.mean()
    if abs(pi - 0.5) >= 2 / sqrt(n):
        return 0.0
    v = 1 + np.count_nonzero(b[1:] != b[:-1])
    return erfc(abs(v - 2 * n * pi * (1 - pi)) / (2 * sqrt(2 * n) * pi * (1 - pi)))

def longest_run(b):  # M = 10000, n >= 750000
    M, K, Nb = 10000, 6, 75
    V = [10, 11, 12, 13, 14, 15, 16]
    P = [0.0882, 0.2092, 0.2483, 0.1933, 0.1208, 0.0675, 0.0727]
    counts = np.zeros(7)
    for blk in b[:Nb * M].reshape(Nb, M):
        d = np.diff(np.concatenate(([0], blk, [0])))
        starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
        lr = int((ends - starts).max()) if len(starts) else 0
        counts[min(max(lr, 10), 16) - 10] += 1
    chi = np.sum((counts - Nb * np.array(P)) ** 2 / (Nb * np.array(P)))
    return gammaincc(K / 2, chi / 2)

def dft(b):
    n = len(b); x = 2 * b.astype(np.float64) - 1
    m = np.abs(np.fft.fft(x))[: n // 2]
    T = sqrt(log(1 / 0.05) * n)
    N0 = 0.95 * n / 2; N1 = np.count_nonzero(m < T)
    d = (N1 - N0) / sqrt(n * 0.95 * 0.05 / 4)
    return erfc(abs(d) / sqrt(2))

def _psi2(b, m):
    if m <= 0:
        return 0.0
    n = len(b); ext = np.concatenate((b, b[: m - 1])).astype(np.int64)
    idx = np.zeros(n, dtype=np.int64)
    for k in range(m):
        idx = (idx << 1) | ext[k:k + n]
    c = np.bincount(idx, minlength=2 ** m)
    return (2 ** m / n) * np.sum(c.astype(np.float64) ** 2) - n

def serial(b, m=10):
    p0, p1, p2 = _psi2(b, m), _psi2(b, m - 1), _psi2(b, m - 2)
    d1, d2 = p0 - p1, p0 - 2 * p1 + p2
    return min(gammaincc(2 ** (m - 2), d1 / 2), gammaincc(2 ** (m - 3), d2 / 2))

def _phi(b, m):
    n = len(b); ext = np.concatenate((b, b[: m - 1])).astype(np.int64)
    idx = np.zeros(n, dtype=np.int64)
    for k in range(m):
        idx = (idx << 1) | ext[k:k + n]
    c = np.bincount(idx, minlength=2 ** m).astype(np.float64) / n
    c = c[c > 0]
    return np.sum(c * np.log(c))

def approx_entropy(b, m=10):
    n = len(b); ap = _phi(b, m) - _phi(b, m + 1)
    chi = 2 * n * (log(2) - ap)
    return gammaincc(2 ** (m - 1), chi / 2)

def cusum(b):
    x = 2 * b.astype(np.int64) - 1; n = len(x); ps = []
    for seq in (x, x[::-1]):
        z = np.max(np.abs(np.cumsum(seq)))
        k1 = np.arange(int((-n / z + 1) / 4), int((n / z - 1) / 4) + 1)
        k2 = np.arange(int((-n / z - 3) / 4), int((n / z - 1) / 4) + 1)
        p = 1 - np.sum(norm.cdf((4 * k1 + 1) * z / sqrt(n)) - norm.cdf((4 * k1 - 1) * z / sqrt(n))) \
              + np.sum(norm.cdf((4 * k2 + 3) * z / sqrt(n)) - norm.cdf((4 * k2 + 1) * z / sqrt(n)))
        ps.append(p)
    return min(ps)

TESTS = [('Frequency (monobit)', monobit), ('Block frequency', block_frequency), ('Runs', runs),
         ('Longest run of ones', longest_run), ('Spectral (DFT)', dft), ('Serial (m=10)', serial),
         ('Approximate entropy (m=10)', approx_entropy), ('Cumulative sums', cusum)]

SEQ = 1_000_000
for path in sys.argv[1:]:
    bits = np.unpackbits(np.fromfile(path, dtype=np.uint8))
    nseq = len(bits) // SEQ
    print(f'\n{path}: {nseq} sequences x {SEQ} bits')
    total_ok = True
    for name, fn in TESTS:
        ps = [fn(bits[i * SEQ:(i + 1) * SEQ]) for i in range(nseq)]
        passed = sum(p >= ALPHA for p in ps)
        # NIST proportion rule: pass rate >= p_hat - 3*sqrt(p_hat(1-p_hat)/s)
        need = int(np.ceil(nseq * (0.99 - 3 * sqrt(0.99 * 0.01 / nseq))))
        # NIST p-value uniformity check (chi-square, 10 bins); requires >= 55 sequences
        hist = np.histogram(ps, bins=10, range=(0, 1))[0]
        p_t = gammaincc(9 / 2, np.sum((hist - nseq / 10) ** 2 / (nseq / 10)) / 2)
        ok = passed >= need and (nseq < 55 or p_t >= 0.0001)
        total_ok &= ok
        print(f'  {"PASS" if ok else "FAIL"}  {name:28s} {passed}/{nseq}  (need {need})  min p = {min(ps):.4f}  uniformity P = {p_t:.4f}')
    print(f'  => {"ALL PASS" if total_ok else "FAILED"}')
