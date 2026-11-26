# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |

## Scope

QTH-512 has not been independently cryptanalysed. Its security figures are the authors' own estimates (see [SPEC.md, section 6](SPEC.md#6-security)). It is not intended for protecting production data, passwords, keys or funds.

The reference implementation is not constant-time. Timing side channels on secret inputs are a known property, not a vulnerability.

## Reporting cryptanalysis

Attacks on the design are welcome in public. Open a GitHub issue and include:

- the property affected: preimage, second preimage, collision or distinguisher
- the attack cost, or a proof of concept
- the QTH-512 version

## Reporting implementation bugs

Report bugs that could affect existing users privately, through GitHub: **Security → Report a vulnerability** on the repository page.

Expect a first response within 7 days. Confirmed issues are fixed in a patch release and credited to the reporter, unless they ask otherwise.
