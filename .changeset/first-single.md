---
'@callis/core': minor
---

Add `first()` and `single()` to synchronous model-less evaluation. Both preserve selected input items; empty input returns empty, and `single()` raises `eval/singleton-expected` for multiple items.
