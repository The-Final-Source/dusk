import { act } from "react";
import { render, screen, type RenderResult } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// React 19.2 flushes renders asynchronously even under act — await the flush.
async function renderAsync(ui: Parameters<typeof render>[0]): Promise<RenderResult> {
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(ui);
  });
  return result!;
}

import { AdherencePanel, CoveragePanel, IntentTreePanel, type AdherenceData } from "./panels.js";

// P5-T14 (web half) — the three registry views render without runtime errors
// against fixture data, and the excluded surfaces (pagination, editing, live
// updates, auth changes) are verifiably absent. Zero-model, component-level.

const data: AdherenceData = {
  package: "packages/shared",
  intents: [
    {
      path: "notifications/send",
      description: "Send notifications persist-first.",
      obligation: "must",
      total_aspects: 2,
      unsatisfied_aspects: [],
      satisfied: true,
      claimed_in_package: true,
    },
    {
      path: "notifications/send/unit-tests",
      description: "Unit tests cover the send path.",
      obligation: "must",
      total_aspects: 1,
      unsatisfied_aspects: ["covers-persist-first"],
      satisfied: false,
      claimed_in_package: false,
    },
  ],
  coverage: [
    { file: "packages/shared/src/schemas/user.ts", decorated_units: 3, undecorated_units: 1 },
    { file: "packages/shared/src/schemas/sync.ts", decorated_units: 2, undecorated_units: 0 },
  ],
};

describe("the Adherence view renders the per-intent satisfaction rollup", () => {
  it("displays each intent with its satisfaction state", async () => {
    await renderAsync(<AdherencePanel data={data} />);
    expect(screen.getByText("Adherence")).toBeTruthy();
    expect(screen.getByText("notifications/send")).toBeTruthy();
    expect(screen.getByText(/2\/2 aspects satisfied/)).toBeTruthy();
    expect(screen.getByText(/unsatisfied: covers-persist-first/)).toBeTruthy();
  });
});

describe("the Intent-tree view renders the hierarchical graph", () => {
  it("nests child intents under their parents", async () => {
    const { container } = await renderAsync(<IntentTreePanel data={data} />);
    expect(screen.getByText("Intent tree")).toBeTruthy();
    expect(screen.getByText("notifications")).toBeTruthy();
    expect(screen.getByText("unit-tests")).toBeTruthy();
    // The child sits inside a nested list under the parent branch.
    expect(container.querySelectorAll("ul ul").length).toBeGreaterThan(0);
  });
});

describe("the Decoration-coverage view renders per-file unit counts", () => {
  it("tabulates decorated vs undecorated units", async () => {
    await renderAsync(<CoveragePanel data={data} />);
    expect(screen.getByText("Decoration coverage")).toBeTruthy();
    expect(screen.getByText("packages/shared/src/schemas/user.ts")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });
});

describe("feature-completeness is explicitly out of scope", () => {
  it("no pagination, no editing, no form/input/button surfaces in any view", async () => {
    for (const panel of [<AdherencePanel data={data} />, <IntentTreePanel data={data} />, <CoveragePanel data={data} />]) {
      const { container, unmount } = await renderAsync(panel);
      expect(container.textContent?.length ?? 0).toBeGreaterThan(0); // a real render, not an empty container
      expect(container.querySelectorAll("button, input, form, select, textarea")).toHaveLength(0);
      expect(container.textContent).not.toMatch(/next page|previous|page \d/i);
      unmount();
    }
  });
});
