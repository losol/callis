---
'@callis/core': minor
---

Add the math functions `abs()`, `ceiling()`, `exp()`, `floor()`, `ln()`, `log(base)`, `power(exponent)`, `round([precision])`, `sqrt()` and `truncate()`. An empty input gives an empty result, more than one item raises `eval/singleton-expected`, and a value that is not a number raises `eval/type-mismatch`. Results that cannot be represented are empty: `(-1).sqrt()`, `(-1).power(0.5)` and an Integer result outside the 32-bit range. `abs()` also takes a Quantity and keeps its unit. `log()` of zero or a negative number, or to such a base, raises `eval/invalid-argument`, as does a negative `round()` precision. `power()` and `round()` always return a Decimal, as FHIRPath 3.0.0 specifies.
