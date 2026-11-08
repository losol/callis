---
'@callis/core': minor
---

Add the conversion functions: `iif()`, and `toBoolean()`, `toInteger()`, `toDecimal()`, `toDate()`, `toDateTime()`, `toTime()`, `toString()` and `toQuantity([unit])` with their `convertsTo…()` counterparts. `iif()` evaluates only the branch it selects, with the input as `$this`. A conversion takes one item: empty input gives empty, more than one item raises `eval/singleton-expected`, and a value that does not convert gives empty from `toX()` and `false` from `convertsToX()`. `toString()` keeps the precision of a Decimal and writes dates and times without `@`; `toQuantity(unit)` converts with the configured unit system.
