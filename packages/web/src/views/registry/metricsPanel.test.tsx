import { act } from "react";
import { render, screen, type RenderResult } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  MetricsPanel,
  type DogfoodReportView,
  type Envelope,
  type StaticAnalysisReportView,
} from "./metricsPanel.js";

// v1.x vertical slice — the web Metrics view renders the pipeline-built
// metrics surface's data (dogfood + static-analysis) without runtime errors.
// Zero-model, component-level.

async function renderAsync(ui: Parameters<typeof render>[0]): Promise<RenderResult> {
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(ui);
  });
  return result!;
}

const dogfood: Envelope<DogfoodReportView> = {
  present: true,
  data: {
    package: "packages/shared",
    window: { days: 3 },
    gating: {
      e2e_implement_success_count: { value: 1, threshold: ">= 1", pass: true },
      gate_false_positive_count: { value: 0, threshold: "== 0", pass: true },
      worked_example_regression: { value: "clean", threshold: "clean", pass: true },
      package_test_suite: { value: "green", threshold: "green", pass: true },
      pass: true,
    },
  },
};

const staticAnalysis: Envelope<StaticAnalysisReportView> = {
  present: true,
  data: {
    mode: "conservative",
    findings: [{ class: "s_not_subset_d", file: "src/notify.ts", line: 12, severity: "warning" }],
    density_baseline: [{ file: "src/notify.ts", decorated_units: 3, undecorated_units: 1 }],
  },
};

describe("the Metrics view renders the served dogfood + static-analysis reports", () => {
  it("shows the GO verdict and the four gated thresholds", async () => {
    await renderAsync(<MetricsPanel dogfood={dogfood} staticAnalysis={staticAnalysis} />);
    expect(screen.getByText("Dusk metrics")).toBeTruthy();
    expect(screen.getByText("GO")).toBeTruthy();
    expect(screen.getByText("End-to-end implement success")).toBeTruthy();
    expect(screen.getByText(/day 3 of the window/)).toBeTruthy();
  });

  it("renders static-analysis findings + the density baseline", async () => {
    await renderAsync(<MetricsPanel dogfood={dogfood} staticAnalysis={staticAnalysis} />);
    // Both the finding line and the density row mention the file; assert presence,
    // not uniqueness (regex matches nested elements too).
    expect(screen.getAllByText(/\[warning\] s_not_subset_d/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/src\/notify\.ts/).length).toBeGreaterThanOrEqual(2);
  });

  it("degrades gracefully when an artifact is absent", async () => {
    const { container } = await renderAsync(
      <MetricsPanel dogfood={{ present: false, data: null }} staticAnalysis={{ present: false, data: null }} />,
    );
    expect(container.textContent).toContain("No dogfood report available.");
    expect(container.textContent).toContain("No static-analysis report available.");
  });
});
