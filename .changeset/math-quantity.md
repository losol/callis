---
'@callis/core': minor
---

`ceiling()`, `floor()`, `round([precision])` and `truncate()` also take a Quantity, as FHIRPath 3.0.0 specifies, and return a Quantity with the same unit: `(5.5 'mg').ceiling()` is `6 'mg'` and `(5.55 'mg').round(1)` is `5.6 'mg'`. Before, they raised `eval/type-mismatch` for a Quantity. The value of the result stays a Decimal, so a whole number outside the Integer range is kept: `(3000000000.5 'mg').floor()` is `3000000000 'mg'`.
