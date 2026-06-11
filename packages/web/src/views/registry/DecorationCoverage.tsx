import { trpc } from "@dusk/hooks";

import { CoveragePanel } from "./panels.js";

const DOGFOOD_PACKAGE = "packages/shared";

export function DecorationCoverage() {
  const query = trpc.registry.getAdherenceSummary.useQuery({ package: DOGFOOD_PACKAGE });
  if (query.isLoading) return <p className="text-gray-500">Loading coverage…</p>;
  if (query.error) return <div className="bg-red-50 text-red-600 p-3 rounded">{query.error.message}</div>;
  return <CoveragePanel data={query.data!} />;
}
