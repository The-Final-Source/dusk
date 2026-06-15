# decoration-parser Specification

## Purpose
TBD - created by archiving change phase-1-substrate. Update Purpose after archive.
## Requirements
### Requirement: The six decorator markers parse to structured records

`packages/core/decoration` SHALL parse the six markers over TypeScript — `@intent` (focal), `@intent-support` (with an inline 3-slot NL triple), `@intent-test`, `@intent-test-file`, `@intent-file`, and `@intent-ignore` (with `because=(s,p,o)` and `reason="..."`) — into one decoration record per occurrence carrying `{ file, line, scope, declaration_name|null, marker, intent_path, aspect_ids[]|null, support_triple|null, ignore_clause|null }`, per RFC §2.4–2.8, App. A.2. (Plan P1-T8.)

#### Scenario: All six markers parse to records

- **WHEN** a file exercising all six markers (including a support triple and a `because`/`reason` ignore clause) is parsed
- **THEN** one record per occurrence is produced with the correct marker, intent_path, aspect_ids, support_triple or ignore_clause, and file:line

### Requirement: `.intent` directory-scope files

The parser SHALL parse `.intent` directory files as directory-level focal claims, one claim per line, per RFC §2.7, App. A.3. These express genuinely directory-level invariants — not cross-cutting concerns, which decorate the touching functions. (Plan P1-T16.)

#### Scenario: Directory-scope claim is recorded

- **WHEN** a `.intent` file at a directory declares a directory-level intent claim
- **THEN** a directory-scoped focal claim is recorded for that directory

#### Scenario: Multiple claims on one line are rejected

- **WHEN** a `.intent` line contains more than one claim
- **THEN** parsing reports a one-claim-per-line error

### Requirement: One shared scanner feeds all decoration sources into the derived index (keystone)

Decoration scanning SHALL be a single shared scanner in `@dusk/core-decoration` that walks the project, dispatches each file by class (comment-bearing → inline `parseDecorations`; file named `.intent` → directory `parseDotIntent`; `<stem>.intent` → the per-file sidecar parser), and emits a merged `DecorationRecord[]` consumed by `buildDerivedIndex`. The previously triplicated `.ts`-only walkers (`packages/delivery/mcp-server/src/context.ts` `scanDecorations`, `packages/cli/src/project.ts` `scanDecorations`, `packages/cli/src/doctorStaticAnalysis.ts` `collectSources`) SHALL be replaced by this one scanner, so directory `.intent` AND per-file sidecar records reach the index, the Verifier, the reverse-index, and doctor — closing the existing gap where `.intent` was parsed only by the gate and was invisible to the index. (RFC App. D.28; design D1.)

#### Scenario: A directory `.intent` record reaches the derived index (fails today)

- **WHEN** a project containing a directory `.intent` claim is loaded via the shared scanner
- **THEN** that claim appears in `buildDerivedIndex` output and is queryable by `reverse(file)`/`forward(intent)`
- **AND** it is visible to the Verifier and `dusk doctor` (not only to the gate)

#### Scenario: A per-file sidecar record reaches the derived index

- **WHEN** a project containing `package.json.intent` is loaded via the shared scanner
- **THEN** its claims appear in `buildDerivedIndex` output linked to `package.json`

