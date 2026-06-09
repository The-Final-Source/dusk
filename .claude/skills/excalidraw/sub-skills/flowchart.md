# Excalidraw Sub-skill — Flowchart

Process flows, decision trees, swimlanes, step sequences. The viewer reads the diagram to understand "what happens when," following arrows from a start state to one or more terminal states.

## Composition rigor for flowcharts

Before writing the spec, decide:

- **Flow direction.** Top-to-bottom or left-to-right? Pick one and apply it uniformly. Don't mix directions within a single chart — they make the reader work to figure out which arrows go forward and which loop back.
- **Shape vocabulary.** Standard convention:
  - **Rectangle** (sharp or slightly-rounded corners): a process step or action.
  - **Diamond**: a decision point. Always phrased as a yes/no question.
  - **Ellipse** or rounded rectangle: start state, end state, terminal node.
  - **Parallelogram**: input/output (use sparingly; many readers don't know this convention).
- **Decision branch labels.** Every diamond has at least two outbound arrows. Every outbound arrow has a label (`Yes` / `No`, `Approve` / `Reject`, etc.). Branches must be mutually exclusive.
- **Swimlanes (optional).** If steps belong to different actors (user, system, third party), wrap each lane's steps in a `frame` with the actor name as the frame label. Lanes run parallel to the flow direction.
- **Pitch math.** For a vertical flow: row pitch ≥ shape height + 60 (leaves room for arrow + edge label). For horizontal: column pitch ≥ shape width + 80. The viewport height/width follows from your step count times the pitch.

## Common flowchart mistakes

- **Decision with one branch.** A diamond with one outbound arrow is just a step in a different shape. Either re-shape it or add the missing branch.
- **Untraceable arrows.** An arrow crosses two unrelated shapes on its way to its target. Move shapes to clear the route.
- **Forgotten terminal.** Every path through the chart must end at a terminal node or rejoin the main flow. No dangling decision branches.
- **Diagonal arrows.** Flow direction is one axis; arrows should mostly run along that axis. Frequent diagonals signal a layout that doesn't match the flow.

## Design-critic mandate addition (flowchart-specific)

When invoking the design critic from SKILL.md, append this scenario-specific check to the prompt:

```
Additionally, audit FLOWCHART-SPECIFIC correctness:

A. Decision branches. Does every diamond have at least two outbound
   arrows, each with a label naming the branch condition? Are the
   labels mutually exclusive?
B. Terminal coverage. Does every path through the chart end at a
   terminal node (start/end ellipse) or rejoin the main flow? No
   dangling decision branches?
C. Loop integrity. If there's a retry / recheck loop, does it loop
   back to the right step? Is there an explicit exit condition?
D. Swimlane consistency. If frames are used as actor lanes, is every
   step inside the correct lane? No step straddling two lanes?
E. Shape semantics. Decisions are diamonds; processes are rectangles;
   start/end nodes are visually distinct from process nodes (rounded
   rectangles or ellipses).
F. Flow direction. The arrows flow consistently in one primary
   direction (top-to-bottom or left-to-right). Any reverse-direction
   arrows are explicit loops with clear loop-back semantics.

Treat any failure here as a REVISE per the main rubric.
```

## When to load this sub-skill

- User describes a process with sequential steps and conditional branches.
- User asks for a decision tree, troubleshooting flow, or onboarding sequence.
- The diagram needs to show "if X then Y, else Z" branching.
- The diagram needs to assign steps to actors/roles (swimlanes).
