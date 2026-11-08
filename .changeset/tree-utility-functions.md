---
'@callis/core': minor
---

Add `children()`, `descendants()`, `trace(name[, projection])`, `now()`, `today()` and `timeOfDay()`. `children()` lists the properties of each input object in document order, without `resourceType` and `_name` keys; `descendants()` lists everything below the input, depth first in document order. `now()`, `today()` and `timeOfDay()` read the clock once per evaluation and are in UTC unless `timezoneOffset` says otherwise. `trace()` returns its input unchanged; the hooks that receive its output come with the expanded public API.
