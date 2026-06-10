import { type DuskContext, type InspectResponse, inspectQuery, loadProjectContext } from "@dusk/mcp-server";

/** Render the §mcp-read-surface inspect response with hierarchical satisfaction + low-confidence supports. */
export function renderInspect(scope: string, value: InspectResponse): string {
  const lines: string[] = [`Inspect: ${scope}`];

  lines.push("\nIntents:");
  for (const intent of value.intents) {
    lines.push(`  ${intent.satisfied ? "✓" : "✗"} ${intent.path} (${intent.obligation})`);
  }

  if (value.aspects_unsatisfied.length > 0) {
    lines.push("\nUnsatisfied aspects:");
    for (const a of value.aspects_unsatisfied) lines.push(`  ✗ ${a.intent_path} [${a.aspect_id}]`);
  }

  if (value.test_intents.length > 0) {
    lines.push("\nTest-pyramid children:");
    for (const t of value.test_intents) lines.push(`  ${t.satisfied ? "✓" : "✗"} ${t.path}`);
  }

  lines.push(`\nClaims: ${value.claims.length} focal, ${value.support_claims.length} support`);

  if (value.low_confidence_supports.length > 0) {
    lines.push("\nLow-confidence supports:");
    for (const s of value.low_confidence_supports) {
      lines.push(`  ! ${s.intent_path} [${s.aspect_id}] ${s.triple_verdict}: ${s.claim.file}:${s.claim.lines[0]} ${JSON.stringify(s.support_triple)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** `dusk inspect <scope>` — build the project context and render the inspect report. */
export function inspectReport(root: string, scope: string): { ok: boolean; text: string } {
  const ctx: DuskContext = loadProjectContext(root);
  const result = inspectQuery(ctx, scope);
  if (!result.success) return { ok: false, text: `inspect: ${result.error.message}\n` };
  return { ok: true, text: renderInspect(scope, result.value) };
}
