import { trpc } from "@dusk/hooks";

import {
  MetricsPanel,
  type DogfoodReportView,
  type Envelope,
  type StaticAnalysisReportView,
} from "./metricsPanel.js";

const DOGFOOD_PACKAGE = "packages/shared";

export function Metrics() {
  const dogfood = trpc.metrics.dogfoodReport.useQuery({ packageName: DOGFOOD_PACKAGE });
  const staticAnalysis = trpc.metrics.staticAnalysisReport.useQuery({ packageName: DOGFOOD_PACKAGE });
  if (dogfood.isLoading || staticAnalysis.isLoading) return <p className="text-gray-500">Loading metrics…</p>;
  if (dogfood.error || staticAnalysis.error) {
    return <div className="bg-red-50 text-red-600 p-3 rounded">{(dogfood.error ?? staticAnalysis.error)!.message}</div>;
  }
  return (
    <MetricsPanel
      dogfood={dogfood.data as Envelope<DogfoodReportView>}
      staticAnalysis={staticAnalysis.data as Envelope<StaticAnalysisReportView>}
    />
  );
}
