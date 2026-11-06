---
'@callis/core': minor
---

Add the internal equality, equivalence and ordering kernels behind `=`, `!=`, `~`, `!~`, `<`, `<=`, `>` and `>=`, with implicit Integer → Decimal, number → Quantity and Date → DateTime conversions, recursive comparison of complex JSON values, a hook for model-specific equivalence, and the model-less date convenience that reads input strings as dates when they are compared with a date/time. The operators that use them follow with the evaluator.
