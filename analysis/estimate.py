"""Attacker-favourable security estimate for the QTH-512 lattice layer.

Collision in C:  nonzero v in {-1,0,1}^m with A v = 0 (mod q)   (Ring-SIS, infinity norm 1)
Preimage of C:   binary x with A x = y                           (inhomogeneous, no easier)
Parameters:      n = 256 equations, q = 12289, m = 32 * 256 = 8192 input bits per call

Attacks considered:
 1. BKZ lattice reduction. Any vector of Euclidean length <= sqrt(d) in a d-dimensional
    sub-lattice counts as a success, although most such vectors are not ternary.
    Cost: core-SVP, 2^(0.292 b) classical and 2^(0.265 b) quantum (Albrecht et al.).
 2. Generalised birthday (Wagner k-tree), the best known attack on SWIFFT.
"""
from math import log2, pi, e, sqrt

n, q, m = 256, 12289, 8192
nlogq = n * log2(q)

def delta(b):
    return ((b / (2 * pi * e)) * (pi * b) ** (1 / b)) ** (1 / (2 * (b - 1)))

def bkz_ok(b):
    ld = log2(delta(b))
    for d in range(n + 1, m + 1, 8):
        length = d * ld + nlogq / d          # log2 of delta^d * q^(n/d)
        if length <= 0.5 * log2(d):          # <= sqrt(d)
            return d
    return None

b = 50
while not bkz_ok(b):
    b += 1
d = bkz_ok(b)

def wagner():
    best = None
    for t in range(1, 14):
        k = 2 ** t
        need = nlogq / (1 + t)               # log2 list size needed
        have = (m / k) * log2(3)             # log2 of ternary choices per list
        if have >= need:
            cost = t + need
            if best is None or cost < best[0]:
                best = (cost, k)
    return best

w = wagner()
print(f"n*log2(q)                 = {nlogq:.0f} output bits per compression")
print(f"BKZ block size needed     = {b}  (sub-dimension d = {d}, delta = {delta(b):.6f})")
print(f"  core-SVP classical      = 2^{0.292 * b:.0f}")
print(f"  core-SVP quantum        = 2^{0.265 * b:.0f}")
print(f"Wagner k-tree (best k={w[1]}) = 2^{w[0]:.0f}")
print(f"Generic birthday on output = 2^{nlogq / 2:.0f}")
lat = min(0.265 * b, w[0])
print(f"Lattice layer collision (min, quantum) ~ 2^{lat:.0f}")
