## ADDED Requirements

### Requirement: One shared scanner feeds all decoration sources into the derived index (keystone)

Decoration scanning SHALL be a single shared scanner in `@dusk/core-decoration` that walks the project, dispatches each file by class (comment-bearing → inline `parseDecorations`; file named `.intent` → directory `parseDotIntent`; `<stem>.intent` → the per-file sidecar parser), and emits a merged `DecorationRecord[]` consumed by `buildDerivedIndex`. The previously triplicated `.ts`-only walkers (`packages/delivery/mcp-server/src/context.ts` `scanDecorations`, `packages/cli/src/project.ts` `scanDecorations`, `packages/cli/src/doctorStaticAnalysis.ts` `collectSources`) SHALL be replaced by this one scanner, so directory `.intent` AND per-file sidecar records reach the index, the Verifier, the reverse-index, and doctor — closing the existing gap where `.intent` was parsed only by the gate and was invisible to the index. (RFC App. D.28; design D1.)

#### Scenario: A directory `.intent` record reaches the derived index (fails today)

- **WHEN** a project containing a directory `.intent` claim is loaded via the shared scanner
- **THEN** that claim appears in `buildDerivedIndex` output and is queryable by `reverse(file)`/`forward(intent)`
- **AND** it is visible to the Verifier and `dusk doctor` (not only to the gate)

#### Scenario: A per-file sidecar record reaches the derived index

- **WHEN** a project containing `package.json.intent` is loaded via the shared scanner
- **THEN** its claims appear in `buildDerivedIndex` output linked to `package.json`
