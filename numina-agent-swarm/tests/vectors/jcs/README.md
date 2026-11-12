# Provenance for the vendored RFC 8785 vectors

These files exercise `canonicalize()` against the JSON Canonicalization Scheme
(RFC 8785). They are test inputs, not a certification that every RFC 8785
rule is implemented.

## Source

- Project: https://github.com/cyberphone/json-canonicalization
- Upstream commit: `32a48195b9b20fe67b1795e39e4509f14d860b45`
- Commit date: 2026-10-11 17:25:17 +0200
- Subject: Merge pull request #38 from SashaMIT/fix/reject-invalid-unicode
- License: Apache License 2.0. Copyright 2018 Anders Rundgren.
  The upstream license text is `UPSTREAM-LICENSE.txt` in this directory
  (SHA-256 below). No other license was added.

`input/` and `output/` are byte-for-byte copies of `testdata/input/` and
`testdata/output/` at that commit. `testdata/outhex/` is not included. It is
a hexadecimal dump of the same output bytes.

## File SHA-256

```
e503b6d71d1afa595b1c74b1016445c944cd89f90418066b23de1aeda7d17563  input/arrays.json
03676a951cd8753ac62589f72eb2105cc782c33425418cfe1d517c111f6e5d5a  input/french.json
d66893805be1784116af50af3110d08766c70a6b4aad93374723f72346e7aaa6  input/structures.json
4621864e014d4a805a563f55b9ea20aba4a2d2dc09c7394f625496998c00702c  input/unicode.json
c4a041b503d6bc236036ef44db4dac499272f60fc22c40dc3b7a54870ba6f1c3  input/values.json
a3a905266bd4a49a969274ea69baa14ee0c4af0ead926d6fa2b7612b4af75387  input/weird.json
099601b171cafed97c333f8878d68e7f8c8f795412adb34b2fdcf0e7c7beac42  output/arrays.json
d99d0ebdcb0033cb858cfa830ae46bc0fb3309413b271f1da828c89901a27ed5  output/french.json
605f65004ec2db7692522a0852c22f1c989e036d547e88963d1a3143cf3195d5  output/structures.json
0d99aad92a125196ff887876643fd3206786a84ddce2cee52ba4ad256d2381d3  output/unicode.json
2d5e01a318d0f0879ab568c4be289c8b1f64ef8921a53c6277d5e069978baacb  output/values.json
6af595a9aa80110b964b4de3f82a05fa6ae7423005019bacfa2620dddc4e94d1  output/weird.json
96c913396ff964af3d2e1661b9153ecbc219b7449e3849a6e27ed07a27e6863f  es6-numbers-static.txt
6821faaddedf2d78c95bb6d98b127e9e616097afd2f6bcc34389f000d13ab12d  UPSTREAM-LICENSE.txt
```

The twelve `input/` and `output/` digests match the upstream blobs at the
commit above.

## ES6 number sample

`es6-numbers-static.txt` is a bounded sample, not the upstream 100,000,000-line
release file
`https://github.com/cyberphone/json-canonicalization/releases/download/es6testfile/es6testfile100m.txt.gz`.

It is the static edge-case prefix from `testdata/numgen.js` at the commit
above (`staticU64s`, 168 values), written in that generator's line format:

```text
hex-ieee,expected\n
```

`hex-ieee` is the IEEE 754 binary64 bit pattern in hexadecimal. `expected` is
ECMAScript `Number.prototype.toString` of that value, which is the serializer
RFC 8785 §3.2.2.3 requires. The 2,000 following serial subnormal values and
the SHA-256 random stream are not included. The file was produced with
Node.js 26.13.0. On that runtime, `JSON.stringify` matched `toString` for
every vendored line.

Upstream publishes SHA-256 values for prefixes of the full generated file
(uncompressed). Those hashes are not the hash of this 168-line sample:

| Lines | SHA-256 |
| --- | --- |
| 1000 | `be18b62b6f69cdab33a7e0dae0d9cfa869fda80ddc712221570f9f40a5878687` |
| 10000 | `b9f7a8e75ef22a835685a52ccba7f7d6bdc99e34b010992cbc5864cd12be6892` |
| 100000 | `22776e6d4b49fa294a0d0f349268e5c28808fe7e0cb2bcbe28f63894e494d4c7` |
| 1000000 | `49415fee2c56c77864931bd3624faad425c3c577d6d74e89a83bc725506dad16` |
| 10000000 | `b9f8a44a91d46813b21b9602e72f112613c91408db0b8341fb94603d9db135e0` |
| 100000000 | `0f7dda6b0837dde083c5d6b896f7d62340c8a2415b0c7121d83145e08a755272` |

`testdata/README.md` also publishes these example lines. The test checks them
directly. The first two are not part of the 168-line static prefix:

```text
4340000000000001,9007199254740994
4340000000000002,9007199254740996
444b1ae4d6e2ef50,1e+21
3eb0c6f7a0b5ed8d,0.000001
3eb0c6f7a0b5ed8c,9.999999999999997e-7
8000000000000000,0
0,0
```

## RFC 8785 section map

Published RFC 8785 numbers are used. Array order is specified inside §3.2.3,
not as its own subsection.

| Vector or test | Section |
| --- | --- |
| Whitespace removed from parsed JSON | §3.2.1 |
| `values.json` literals, strings, and numbers | §3.2.2, §3.2.2.1, §3.2.2.2, §3.2.2.3 |
| `es6-numbers-static.txt` and the published sample lines | §3.2.2.3 |
| `arrays.json`, `structures.json` element order | §3.2.3 (array order must not change) |
| `french.json`, `weird.json`, `structures.json` member order | §3.2.3 UTF-16 code-unit sort, not locale order |
| `unicode.json` | §3.1, no Unicode normalization |
| Output byte compare | §3.2.4 UTF-8, for these vectors |
| Non-finite numbers and lone surrogates | §3.1 I-JSON, §3.2.2.2, §3.2.2.3 |

## Known gaps

- Duplicate JSON object names are rejected by `tokenize()` on raw text
  (I-JSON §3.1). `canonicalize()` still cannot see a duplicate once a value
  has already been parsed.
- The 100,000,000-line ES6 file and the other published prefix lengths above
  are not vendored and are not run here.
- `testdata/outhex/` is not vendored.
- This directory does not record a Java, Go, or .NET cross-runtime run.
- Appendix D (big numbers as strings) and Appendix E (string subtypes) are not
  implemented beyond rejecting `bigint`, non-finite numbers, and lone surrogates.
