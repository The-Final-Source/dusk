---
name: drizzle-extraction
---

# drizzle-extraction

Handle Drizzle query builders under the decoration model: extract predicate construction (`inArray(...)`) to its own const when it has separable intent participation; keep a `.select().from().where()` chain as one statement when its steps share one intent footprint.
