# Excalidraw Sub-skill — Data Flow

Pipelines, sequence diagrams, ETL flows, request lifecycles. The viewer reads the diagram to understand "how does data move from A to B" — what transformations apply, what shape the data takes at each step.

## Composition rigor for data-flow diagrams

Before writing the spec, decide:

- **Flow direction.** Almost always left-to-right (or top-to-bottom for sequence diagrams). Time / pipeline order maps to the primary axis. Don't reverse.
- **Stage vs transform.** A flow has STAGES (sources, transforms, sinks) and TRANSITIONS (the arrows between). Stages are shapes; transitions are arrows labeled with the data passing through.
- **Sources on the left/top.** External inputs (user, third-party API, file upload) live at the start of the flow. The viewer's eye starts there.
- **Sinks on the right/bottom.** Final destinations (database, queue, file write, response to caller). The viewer's eye ends there.
- **Branching = fan-out, joining = fan-in.** When data splits to multiple destinations, draw a clear branch (a single arrow leaving the source, splitting via separate arrows to each sink). When data merges, draw a join (multiple arrows converging on a single shape).
- **Annotate the data, not the relationship.** Arrow labels say WHAT crosses the arrow ("raw event", "validated JSON", "RowID + score"), not the relationship type ("sends to", "passes to").

## Sequence diagram variant

If the data-flow is a sequence (request lifecycle, RPC chain):

- **Actors as vertical lanes.** Each actor (Client, API, DB) gets a vertical lane — represent with a `rectangle` at the top of the lane (actor box) and a long vertical line below (lifeline). Use `line` with no arrowheads for the lifelines.
- **Messages as horizontal arrows.** Arrows cross from one lifeline to another. The arrow's vertical position = the message's order in time.
- **Synchronous vs async.** Solid arrow = sync (caller waits). Dashed arrow = async (caller fires and forgets). Label this convention in a tiny legend if the audience isn't already familiar.
- **Activation bars (optional).** A narrow rectangle on a lifeline marks "this actor is doing work right now". Useful for showing latency or nested calls; skip if not relevant.

## Common data-flow mistakes

- **Mixing data and control.** A diagram trying to show both data flow AND control flow (decisions, retries) on the same canvas becomes muddled. Choose one and reference the other in a sibling diagram.
- **Generic arrow labels.** "data", "result", "value" — replace with the concrete shape ("validated UserRecord", "[{id, score}]").
- **Time direction reversed.** Sequence diagrams that flow bottom-to-top, or pipelines drawn right-to-left, confuse readers who expect the convention.
- **No clear source/sink demarcation.** When the leftmost shape is a transform instead of a source, the reader has to hunt for where data originates.

## Design-critic mandate addition (data-flow-specific)

When invoking the design critic from SKILL.md, append this scenario-specific check:

```
Additionally, audit DATA-FLOW-SPECIFIC correctness:

A. Flow direction. Is the primary direction (left-to-right or
   top-to-bottom) consistent across the diagram? Time / pipeline
   order matches the axis direction?
B. Sources and sinks placed correctly. External inputs at the start,
   final destinations at the end?
C. Arrow labels name DATA, not relationships. Each arrow label
   describes what crosses it ("raw event", "validated batch") rather
   than the relationship type ("sends to", "passes to")?
D. Fan-out and fan-in. Branches and joins are clearly drawn — when
   data splits, multiple arrows leave a single shape; when data
   merges, multiple arrows converge on a single shape?
E. Stage-vs-transform distinction. Shapes represent stages; arrows
   represent transformations. No transformation drawn as a separate
   shape between two arrows?
F. (Sequence diagrams only) Each actor has a labeled lifeline?
   Messages flow in time order top-to-bottom?

Treat any failure here as a REVISE per the main rubric.
```

## When to load this sub-skill

- User asks for a pipeline diagram, ETL flow, or data-processing topology.
- User asks for a sequence diagram, request lifecycle, or RPC chain.
- The diagram needs to show how a piece of data is transformed across multiple steps.
