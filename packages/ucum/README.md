# @callis/ucum

Full [UCUM](https://ucum.org/ucum) unit conversion for [Callis](https://github.com/losol/callis), the FHIRPath engine for TypeScript.

`@callis/core` ships a minimal unit system: identical units, calendar durations and the UCUM time units. This package is the opt-in for everything else, such as `1 'kg' = 1000 'g'` or `1 'mg/dL'` in `'g/L'` ([ADR-0007](../../docs/adr/0007-ucum-split.md)). It has no runtime dependencies besides its `@callis/core` peer, and it works in any JavaScript runtime: it reads no files and makes no network requests.

## Usage

`ucum` is a `UnitSystem`. Pass it where Callis takes one; the evaluation API that accepts `{ units: ucum }` becomes public in T0025. It can also be called directly:

```ts
import { Decimal } from '@callis/core';
import { ucum } from '@callis/ucum';

ucum.convert(Decimal.ONE, 'mg/dL', 'g/L')?.toString(); // '0.01'
ucum.compare?.(Decimal.of(23n), 'Cel', Decimal.of(734n, 1), '[degF]'); // 0: 23 °C = 73.4 °F
ucum.divide('cm2', 'cm'); // { unit: 'cm', factor: 1 }
ucum.parse('xyz'); // undefined
```

## Behaviour

- **Units.** Every prefix and unit of the UCUM essence file, in case-sensitive expressions with `.`, `/`, exponents, parentheses, annotations (`mg{total}`, `{RBC}`), `10*n` and `10^n`. Annotations do not change a unit's meaning.
- **Conversion** is exact. A conversion whose ratio terminates keeps every digit (`1.0 'm'` is `100.0 'cm'`); a recurring one, such as feet to yards, is rounded once to 28 significant digits. Comparisons use exact ratios, so they are never fooled by that rounding.
- **Special units.** `Cel` and `[degF]` convert on their offset scales (`23 'Cel' = 73.4 '[degF]'`). Other special units, such as `[pH]` or `B[SPL]`, and prefixed or compound uses of `Cel`, are not converted, and special units take no part in `*` and `/`.
- **Arbitrary units** such as `[iU]` only match the identical unit: UCUM makes them commensurable with nothing else, including each other.
- **Calendar durations** (`year`, `month`, `week`, …) keep exactly the rules of the minimal unit system: `week` to `millisecond` equal `'wk'` to `'ms'`, while `year` and `month` are only equivalent to `'a'` and `'mo'`. Calendar units only multiply and divide with `'1'`.
- **`*` and `/`** keep the units as written where possible: identical units add exponents (`'cm2' / 'cm'` is `'cm'`), a unit commensurable with an earlier one that has not cancelled out is converted into it (`'m/s' * 'min'` is `'m'` with factor 60), and fully cancelled units give `'1'` with their ratio (`'cm' / 'm'` is `0.01 '1'`).
- **Errors.** Unknown or invalid units, incommensurable units and results beyond the Decimal size bound give `undefined`. Nothing throws.
- **Bounded work.** Unit strings may come from untrusted data, so a unit whose exact magnitude needs more than 4,096 bits (about 1,200 digits) is rejected, as is a product or quotient whose unit would. The largest unit in the essence file needs 260 bits.

[docs/spec-notes.md](../../docs/spec-notes.md#ucum-unit-algebra) records how these rules follow the FHIRPath and UCUM specifications.

## Data and license

The package contains the essence file of UCUM, `ucum-essence.xml` from [ucum-org/ucum](https://github.com/ucum-org/ucum), byte for byte as published, under the UCUM License, Version 1.1 of the Regenstrief Institute. It is not changed, subset or converted: the MIT-licensed code reads the embedded file once, when the package is first imported, and keeps the resulting tables in memory only.

- [SOURCE.md](SOURCE.md): the pinned upstream commit, the checksums, the copyright notice and how the file is used.
- [LICENSE.md](LICENSE.md): MIT for the code, and the UCUM notice for the data.
- [UCUM-LICENSE.md](UCUM-LICENSE.md): the full UCUM license.

Copyright 1999-2024 Regenstrief Institute, Inc. All rights reserved. The UCUM file is licensed under the UCUM License, Version 1.1; you may obtain a copy at <https://unitsofmeasure.org/license>. It is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

## Size and startup

Measured with `pnpm --filter @callis/ucum measure` (after `pnpm build`) on Node.js 24.18.0, macOS on an Apple M2, 30 runs. Other machines will differ; these are measurements, not guarantees.

| | Built | Minified |
| --- | ---: | ---: |
| Code (`dist/index.js`), gzip | 10.69 kB | 4.93 kB |
| UCUM file as a string (`dist/essence/ucum-essence-xml.js`), gzip | 12.02 kB | 11.77 kB |
| Total, gzip | 22.71 kB | 16.70 kB |

The repository's size check (`scripts/report-size.ts`) allows 24 kB gzip for the built JavaScript, against 22.71 kB now; about 12 kB of that is the UCUM text, which cannot shrink without changing the file. The packed tarball is 76.02 kB (396 kB unpacked, with source maps and the XML file).

Importing the package reads the UCUM file and resolves all 336 units and prefixes. In a fresh process this takes a median of 9.7 ms (p10 9.5 ms, p90 10.1 ms) after `@callis/core` is loaded: about 3.9 ms to read the XML and 4.2 ms to resolve the tables, plus loading the module. Earlier runs on the same machine gave medians between 9.3 and 10.0 ms, so expect variation of that order. Once V8 has optimized the code the same work takes about 1.9 ms, but it only happens once per process. A first conversion then takes about 0.3 ms, and later ones a few microseconds.
