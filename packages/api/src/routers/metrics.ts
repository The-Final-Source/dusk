import { z } from "zod";

import {
  DogfoodReportSchema,
  StaticAnalysisReportSchema,
  type DogfoodReport,
  type StaticAnalysisReport,
} from "@dusk/core-schema";

import { router, publicProcedure } from "../trpc.js";
import { resolveArtifact, type ArtifactEnvelope } from "../services/metrics/artifactResolver.js";

export type Resolver = (packageName: string, artifactType: string) => ArtifactEnvelope;

type MetricsEnvelope<T> =
  | { present: false; data: null; parseError?: string }
  | { present: true; data: T };

// @intent api/metrics/dogfood-report [read-via-resolver, validate-schema, no-throw-on-failure]
function dogfoodReportHandler(packageName: string, resolver: Resolver): MetricsEnvelope<DogfoodReport> {
  // @intent-support api/metrics/dogfood-report [read-via-resolver] ["the dogfood report procedure" "reads" "the dogfood artifact through the artifact resolver"]
  const envelope = resolver(packageName, "dogfood-report");
  // @intent-support api/metrics [presence-envelope] ["the metrics query procedure" "returns" "{ present: false, data: null } when the artifact is absent"]
  if (!envelope.present) return { present: false, data: null };
  // @intent-support api/metrics/dogfood-report [validate-schema] ["the dogfood report procedure" "validates" "the raw payload against the @dusk/core-schema dogfood Zod schema before returning it"]
  const parsed = DogfoodReportSchema.safeParse(envelope.raw);
  // @intent-support api/metrics/dogfood-report [no-throw-on-failure] ["the dogfood report procedure" "returns" "an error envelope instead of throwing when schema validation fails"]
  if (!parsed.success) return { present: false, data: null, parseError: parsed.error.message };
  // @intent-support api/metrics [presence-envelope] ["the metrics query procedure" "returns" "{ present: true, data: <validated payload> } when the artifact is present and valid"]
  return { present: true, data: parsed.data };
}

// @intent api/metrics/static-analysis-report [read-via-resolver, validate-schema, no-throw-on-failure]
function staticAnalysisReportHandler(packageName: string, resolver: Resolver): MetricsEnvelope<StaticAnalysisReport> {
  // @intent-support api/metrics/static-analysis-report [read-via-resolver] ["the static-analysis report procedure" "reads" "the static-analysis artifact through the artifact resolver"]
  const envelope = resolver(packageName, "static-analysis-report");
  // @intent-support api/metrics [presence-envelope] ["the metrics query procedure" "returns" "{ present: false, data: null } when the artifact is absent"]
  if (!envelope.present) return { present: false, data: null };
  // @intent-support api/metrics/static-analysis-report [validate-schema] ["the static-analysis report procedure" "validates" "the raw payload against the @dusk/core-schema static-analysis Zod schema before returning it"]
  const parsed = StaticAnalysisReportSchema.safeParse(envelope.raw);
  // @intent-support api/metrics/static-analysis-report [no-throw-on-failure] ["the static-analysis report procedure" "returns" "an error envelope instead of throwing when schema validation fails"]
  if (!parsed.success) return { present: false, data: null, parseError: parsed.error.message };
  // @intent-support api/metrics [presence-envelope] ["the metrics query procedure" "returns" "{ present: true, data: <validated payload> } when the artifact is present and valid"]
  return { present: true, data: parsed.data };
}

// @intent api/metrics [expose-queries, no-mutations, package-name-param, presence-envelope]
export function createMetricsRouter(resolver: Resolver) {
  // @intent-support api/metrics [package-name-param] ["all metrics query procedures" "accept" "a packageName string parameter validated by Zod"]
  const withPackageName = publicProcedure.input(z.object({ packageName: z.string() }));
  // @intent-support api/metrics [expose-queries] ["the metrics router" "exposes" "the dogfoodReport query procedure for the dogfood report artifact"]
  const dogfoodReport = withPackageName.query(({ input }) => dogfoodReportHandler(input.packageName, resolver));
  // @intent-support api/metrics [expose-queries] ["the metrics router" "exposes" "the staticAnalysisReport query procedure for the static-analysis report artifact"]
  const staticAnalysisReport = withPackageName.query(({ input }) => staticAnalysisReportHandler(input.packageName, resolver));
  // @intent-support api/metrics [expose-queries, no-mutations] ["the metrics router" "assembles" "the two query procedures into a router with no mutations or subscriptions"]
  return router({ dogfoodReport, staticAnalysisReport });
}

// @intent api/metrics [expose-queries, no-mutations, package-name-param, presence-envelope]
export const metricsRouter = createMetricsRouter(resolveArtifact);
