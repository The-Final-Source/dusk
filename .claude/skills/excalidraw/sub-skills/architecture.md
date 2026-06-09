# Excalidraw Sub-skill — Architecture

Component diagrams, service meshes, deployment topology, layered systems. The viewer reads the diagram to understand "what depends on what" and "where the boundaries are."

## Composition rigor for architecture diagrams

Before writing the spec, decide:

- **Boundary hierarchy.** Most systems have natural nesting: process → service → cluster → cloud. Pick the levels relevant to your audience and represent them with `frame` primitives. Don't show more nesting than the reader needs.
- **Dependency direction.** Arrows point FROM the dependent TO the dependency (caller → callee). This is the universal convention; reversing it confuses every reader who knows the convention.
- **Layering.** If the system has logical layers (UI → API → service → data), arrange them on the same axis (vertical or horizontal). Don't intermingle layers — the reader uses the spatial axis as a mental "abstraction level" gradient.
- **Component shapes.** Convention:
  - **Rectangle**: a service, component, module, container.
  - **Cylinder-ish** (use a rounded rectangle since Excalidraw has no cylinder primitive): a datastore.
  - **Ellipse / pill**: an actor (end user, third party, external system).
  - **Hexagon** (use a diamond): a queue or event bus.
- **Color = role**, not category. All datastores share one fill color. All external services share another. All internal services share another. Color encodes role, not arbitrary grouping.
- **Grouping with frames.** A `frame` with a corner label like "AWS us-east-1" or "Production VPC" communicates a boundary cleanly. Frames have no fill and a thin gray stroke (by design); use them when boundary matters.

## Architecture-specific guidance

- **Show what crosses boundaries clearly.** An arrow exiting a frame is more important to the reader than an arrow inside a frame. Differentiate via stroke weight (cross-boundary = 2px, intra-boundary = 1px).
- **Stateless vs stateful matters.** Use the cylinder convention for anything that persists state; rectangles for ephemeral / stateless.
- **Don't draw the data — draw the dependency.** "User → Frontend" tells the reader the frontend depends on user input. Avoid arrow labels that just say "data"; instead, name the contract: "GET /search", "POST /orders".
- **Less is more.** A 6-box architecture diagram is more useful than a 30-box one. If you have 30 components, split into multiple zoomed diagrams.

## Common architecture mistakes

- **Bidirectional arrows everywhere.** A double-headed arrow usually means the author didn't decide which side initiates. Pick one direction (the caller) and use a single-headed arrow.
- **No clear data tier.** Datastores scattered among services with no visual distinction. Group them, color them consistently, or put them in a "data layer" frame.
- **Layer violations are invisible.** If you have a UI box that arrows directly to a database box bypassing the API layer, that's worth showing — but it should look anomalous. Use color, dashed strokes, or a callout annotation.
- **Component labels too generic.** "Service A" / "Backend" / "DB" — replace with the actual names ("AuthZ Service", "Order API", "Postgres orders").

## Design-critic mandate addition (architecture-specific)

When invoking the design critic from SKILL.md, append this scenario-specific check:

```
Additionally, audit ARCHITECTURE-SPECIFIC correctness:

A. Dependency direction. Every arrow points from the dependent TO the
   dependency (caller → callee). Reversed directions are flagged.
B. Layering consistency. If the diagram has logical layers (UI / API /
   service / data), are layers on a consistent spatial axis? No
   intermingling of layers?
C. Boundary clarity. Are boundaries (services, clusters, VPCs)
   represented via frames? Are cross-boundary arrows visually
   differentiated from intra-boundary arrows?
D. Component vocabulary. Are datastores, services, queues, and actors
   shape-coded consistently (e.g., every datastore is a rounded
   rectangle; every external actor is an ellipse)?
E. Color semantic. Does the color palette encode role (datastore vs
   service vs external) rather than arbitrary grouping?
F. Label precision. Component labels name the actual component
   ("AuthZ Service", "Order API"), not a generic placeholder
   ("Service A", "Backend").

Treat any failure here as a REVISE per the main rubric.
```

## When to load this sub-skill

- User asks for a system diagram, service map, or architecture overview.
- User wants to show component dependencies, service-to-service calls, or deployment topology.
- The diagram needs to communicate boundaries (VPC, cluster, process).
