import { trpc } from "@dusk/hooks";

import { AdherencePanel } from "./panels.js";

const DOGFOOD_PACKAGE = "packages/shared";

export function Adherence() {
  const query = trpc.registry.getAdherenceSummary.useQuery({ package: DOGFOOD_PACKAGE });
  if (query.isLoading) return <p className="text-gray-500">Loading adherence…</p>;
  if (query.error) return <div className="bg-red-50 text-red-600 p-3 rounded">{query.error.message}</div>;
  return <AdherencePanel data={query.data!} />;
}
