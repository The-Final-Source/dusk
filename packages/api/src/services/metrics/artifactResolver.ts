import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type ArtifactEnvelope = { present: false } | { present: true; raw: unknown };

// Operator wiring (v1.x dogfood finding): the authored intent only required
// "constructs the artifact file path from the package name and artifact type",
// so the pipeline built a clean generic `.ia/artifacts/<type>.json` path. The
// real artifacts live under `.ia/observability/` at heterogeneous locations —
// this map pins each artifact type to its actual on-disk relative path.
const ARTIFACT_RELATIVE_PATHS: Record<string, string> = {
  "dogfood-report": join(".ia", "observability", "dogfood", "dogfood-report.json"),
  "static-analysis-report": join(".ia", "observability", "static-analysis-report.json"),
};

// @intent api/metrics/artifact-resolution [construct-path, absent-returns-envelope, no-disk-writes]
export function resolveArtifact(packageName: string, artifactType: string, repoRoot?: string): ArtifactEnvelope {
  // @intent-support api/metrics/artifact-resolution [construct-path] ["the artifact resolver" "resolves" "the root directory from the caller-supplied override or the module URL"]
  const root = repoRoot ?? fileURLToPath(new URL("../../../../..", import.meta.url));
  // @intent-support api/metrics/artifact-resolution [construct-path] ["the artifact resolver" "constructs" "the artifact file path from the package name and artifact type at call time"]
  const artifactPath = join(root, packageName, ARTIFACT_RELATIVE_PATHS[artifactType] ?? join(".ia", "artifacts", `${artifactType}.json`));
  // @intent-support api/metrics/artifact-resolution [absent-returns-envelope] ["the artifact resolver" "returns" "{ present: false } without throwing when the artifact file is absent"]
  if (!existsSync(artifactPath)) return { present: false };
  // @intent-support api/metrics/artifact-resolution [no-disk-writes] ["the artifact resolver" "reads" "the artifact file bytes from disk without writing any file"]
  const fileContent = readFileSync(artifactPath, "utf8");
  // @intent-support api/metrics/artifact-resolution [no-disk-writes] ["the artifact resolver" "returns" "the parsed file content wrapped in a present envelope without any disk write"]
  return { present: true, raw: JSON.parse(fileContent) as unknown };
}
