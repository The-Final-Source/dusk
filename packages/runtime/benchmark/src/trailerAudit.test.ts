import { describe, expect, it } from "vitest";

import { auditTrailers, hasFullTrailers, parseGitLog } from "./trailerAudit.js";

// Phase-6 §5.2 — the trailer-audit script (design D5). Zero-model pure pass.
// Unit-tested here against a `git log` text FIXTURE: a clean case + a
// deliberately-malformed-commit negative case proving rejection.
//
// TODO(D5 real-log seam): `parseGitLog` is the wiring point for the REAL POC
// `git log` produced by an actual §4 `dusk implement` run. The real-log test is
// added after the POC §4 build completes — it is NOT fabricated here.

const US = "\x1f"; // matches GIT_LOG_FORMAT's %x1f field separator

/** Build one `git log` record in the GIT_LOG_FORMAT shape this parser consumes. */
function record(sha: string, parents: string[], body: string, files: string[]): string {
  return `COMMIT${US}${sha}${US}${parents.join(" ")}${US}${body}${US}${files.join("\n")}`;
}

const FULL_TRAILERS = [
  "feat(api): cursor-paginated list",
  "",
  "Intent: api/notifications/list/cursor-paginated [decode]",
  "Test-Intent: api/notifications/list/cursor-paginated/unit-tests",
  "Bead-id: bead-001",
  "Verdict-id: verdict-001",
  "Test-Verdict-id: tverdict-001",
  "Trace-id: trace-001",
  "Verifier-model: claude-opus-4",
  "Long-cycle-samples: 0",
  "Test-Suites-passed: 1",
].join("\n");

const SCAFFOLD_BODY = ["chore: dusk init scaffold", "", "(no trailers — exempt scaffold)"].join("\n");

const cleanLog = [
  // Exempt scaffold commit — no trailers, but only touches allowlisted files.
  record("aaa0001", [], SCAFFOLD_BODY, ["package.json", "tsconfig.json", "vitest.config.ts", "test/globalSetup.ts"]),
  // Required-source commit with full trailers.
  record("bbb0002", ["aaa0001"], FULL_TRAILERS, ["src/api/notifications/list.ts", "src/api/notifications/list/unit-tests/list.test.ts"]),
].join("\n");

describe("parseGitLog — the real-log seam (D5)", () => {
  it("parses sha, parents, subject, trailers and changed files from the GIT_LOG_FORMAT shape", () => {
    const commits = parseGitLog(cleanLog);
    expect(commits.map((c) => c.sha)).toEqual(["aaa0001", "bbb0002"]);
    expect(commits[1].parents).toEqual(["aaa0001"]);
    expect(commits[1].subject).toBe("feat(api): cursor-paginated list");
    expect(commits[1].trailers["Intent"]).toEqual(["api/notifications/list/cursor-paginated [decode]"]);
    expect(commits[1].files).toContain("src/api/notifications/list.ts");
    expect(hasFullTrailers(commits[1]).ok).toBe(true);
  });
});

describe("auditTrailers — proves zero hand-written application code from git alone", () => {
  it("passes when every required-source commit carries full trailers and scaffold is exempt", () => {
    const result = auditTrailers({ commits: parseGitLog(cleanLog) });
    expect(result.pass).toBe(true);
    expect(result.handwritten_application_commit_count).toBe(0);
    expect(result.inspected_required_commits).toBe(1); // only bbb0002 touches required source
    expect(result.violations).toEqual([]);
  });

  it("rejects a malformed commit touching required source with a missing trailer, naming it", () => {
    const malformedBody = ["feat(api): hand-written write endpoint", "", "Intent: api/notifications/write", "Bead-id: bead-009"].join("\n");
    // Missing Verdict-id, Trace-id, Verifier-model; touches required source; not a merge.
    const log = [record("ccc0003", ["aaa0001"], malformedBody, ["src/api/notifications/write.ts"])].join("\n");
    const result = auditTrailers({ commits: parseGitLog(log) });
    expect(result.pass).toBe(false);
    expect(result.handwritten_application_commit_count).toBe(1);
    expect(result.violations).toHaveLength(1);
    const v = result.violations[0];
    expect(v.kind).toBe("missing_trailer");
    if (v.kind !== "missing_trailer") return;
    expect(v.sha).toBe("ccc0003");
    expect(v.missing).toEqual(["Verdict-id", "Trace-id", "Verifier-model"]);
    expect(v.offending_files).toEqual(["src/api/notifications/write.ts"]);
  });

  it("accepts a merge commit whose parents all carry full trailers", () => {
    const parentA = record("p0001", ["base000"], FULL_TRAILERS, ["src/api/a.ts"]);
    const parentB = record("p0002", ["base000"], FULL_TRAILERS, ["src/api/b.ts"]);
    // Merge commit: no trailers of its own, touches required source, 2 trailer-bearing parents.
    const merge = record("m0003", ["p0001", "p0002"], "merge: integrate a + b\n\n(no trailers)", ["src/api/a.ts", "src/api/b.ts"]);
    const result = auditTrailers({ commits: parseGitLog([parentA, parentB, merge].join("\n")) });
    expect(result.pass).toBe(true);
    expect(result.handwritten_application_commit_count).toBe(0);
  });

  it("rejects a recorded human action that is not on the whitelist", () => {
    const result = auditTrailers({
      commits: parseGitLog(cleanLog),
      humanActions: [
        { kind: "implement-request", ref: "req-1" },
        { kind: "hand-edit-source", ref: "src/api/x.ts" },
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.violations).toContainEqual({ kind: "non_whitelisted_human_action", action: { kind: "hand-edit-source", ref: "src/api/x.ts" } });
  });

  it("a whitelisted human action set passes", () => {
    const result = auditTrailers({
      commits: parseGitLog(cleanLog),
      humanActions: [
        { kind: "author-dialog-response" },
        { kind: "implement-request" },
        { kind: "commit-review-approval" },
        { kind: "merge-approval" },
      ],
    });
    expect(result.pass).toBe(true);
  });
});
