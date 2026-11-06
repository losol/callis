# UCUM source data

`data/ucum-essence.xml` is the essence file of the Unified Code for Units of Measure (UCUM), published by the Regenstrief Institute, **unchanged**: no unit, field, description or comment is added, removed or edited.

| | |
| --- | --- |
| Repository | <https://github.com/ucum-org/ucum> |
| Commit | `e6660c5745d460c2f5e98675594f7ae9c8efc2a3` |
| File | `ucum-essence.xml`: UCUM version 2.2, revision date 2024-06-17 |
| Size | 82,776 bytes |
| SHA-256 | `dfccea1b5dc284245ebae97edd1dc03c45864da4e87df55bc9851797b4fd0b61` |
| License | UCUM Copyright Notice and License, Version 1.1 (June 2024): [UCUM-LICENSE.md](UCUM-LICENSE.md), copied unchanged from `LICENSE.md` of the same commit (SHA-256 `b7989c84c68b7a80d42aad28cfdd824d756c2f70f26eaf1347d2e49f7838bbdf`), and at <https://unitsofmeasure.org/license> |

`data/source.json` records the same checksums. The tests and `pnpm --filter @callis/ucum check:package` verify them, also in the packed package.

## Notice

Copyright 1999-2024 Regenstrief Institute, Inc. All rights reserved. Licensed under the UCUM License, Version 1.1 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at <https://unitsofmeasure.org/license>.

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

The UCUM license grants no trademark rights (its section 6); the name UCUM is used here only to describe where the file comes from. Callis is not endorsed by the Regenstrief Institute.

## How the package uses the file

- The package contains the file twice, both times byte for byte: as `data/ucum-essence.xml`, and as one string in `dist/essence/ucum-essence-xml.js`, which `scripts/embed-essence.ts` generates from `data/ucum-essence.xml` with the notice above. The string lets the package read the file in any JavaScript runtime, without file system or network access.
- When the package is first imported, its MIT-licensed code reads that string and builds lookup tables in memory. Nothing derived from the file is stored or distributed, and the package has no runtime dependencies.
- The code implements behaviour that the essence file does not contain, from the [UCUM specification](https://ucum.org/ucum) text: the expression grammar, and the conversion functions of the special units `Cel` and `[degF]`. Other special units are not converted.

The owner chose this approach for [T0007](../../docs/tasks/T0007-ucum.md) after checking the UCUM license: the file is redistributed whole and unmodified, with the notices its section 3(b) asks for, instead of tables generated from it.

To update the file, replace `data/ucum-essence.xml` and `UCUM-LICENSE.md` with the files of a newer upstream commit, update `data/source.json` and this file, and run `pnpm --filter @callis/ucum embed`.
