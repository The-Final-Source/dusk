/**
 * `withTransportRetry` / `TransportLegFailure` were lifted into the `@dusk/core-schema`
 * leaf (RFC App. D.34, design D1) so the runtime verifier path can reach them
 * without a `@dusk/runtime-benchmark` edge. This module re-exports them for
 * back-compat with existing benchmark consumers (`realAuditCall.ts`, `index.ts`).
 */
export { withTransportRetry, TransportLegFailure } from "@dusk/core-schema";
