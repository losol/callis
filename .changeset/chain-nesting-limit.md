---
'@callis/core': patch
---

Count chains towards the nesting limit while parsing. Each step of a chain such as `a.b.c…`, `x.f().g()…`, `a[0][0]…` or `x and y and …` nests the chain before it one level deeper. Expressions deeper than 1,000 levels still raise `syntax/nesting-limit`, now with the span of the step that passes the limit instead of the chain's first node. Parentheses count as a level, as they already did for nested sub-expressions, now also when a chain continues after them: `(a.a….a).b` with 998 steps inside the parentheses is 1,000 levels deep without them and compiled before, and is now rejected.
