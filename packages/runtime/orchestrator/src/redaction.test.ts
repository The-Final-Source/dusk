import { describe, expect, test } from "vitest";

import { REDACTED_ABS_PATH, REDACTED_ANTHROPIC, redact, redactDeep } from "./redaction.js";

// Task 1.2 — redaction allowlist over a known-secret corpus (unit-only, pure transform).

describe("redact — Anthropic API key shape", () => {
  test("scrubs an Anthropic-style key and leaves no key bytes behind", () => {
    const key = "sk-ant-api03-AbCd1234EfGh5678IjKl90mnOpQr_sTuv-WXyz";
    const out = redact(`Authorization: Bearer ${key}\n`);
    expect(out).toContain(REDACTED_ANTHROPIC);
    expect(out).not.toContain(key);
    expect(out).not.toContain("sk-ant-");
  });
});

describe("redact — absolute path shape", () => {
  test("scrubs a generic absolute fs path", () => {
    const out = redact("see /Users/alice/secrets/config.json for details");
    expect(out).toContain(REDACTED_ABS_PATH);
    expect(out).not.toContain("/Users/alice");
  });

  test("scrubs an injected repoRoot exactly", () => {
    const repoRoot = "/var/folders/r3/abc/T/dusk-test-XYZ";
    const out = redact(`file at ${repoRoot}/packages/foo/index.ts`, { repoRoot });
    expect(out).toContain(REDACTED_ABS_PATH);
    expect(out).not.toContain(repoRoot);
  });

  test("does NOT redact relative intent paths (no leading slash)", () => {
    const out = redact("intent notifications/send [publish-sync-per-insert] holds");
    expect(out).toBe("intent notifications/send [publish-sync-per-insert] holds");
  });
});

describe("redactDeep — every field of a trace-like object", () => {
  test("scrubs nested string fields and preserves non-strings", () => {
    const trace = {
      trace_id: "tr_1",
      prompt_tokens: 42,
      cost_usd: 0.01,
      raw_prompt: "key sk-ant-api03-DEADbeef1234567890ABCDEF at /home/bob/repo",
      skills_loaded: ["dusk/engineer/decoration-completeness"],
      nested: { quote: "ran /Users/carol/x.ts" },
    };
    const out = redactDeep(trace);
    expect(out.prompt_tokens).toBe(42);
    expect(out.cost_usd).toBe(0.01);
    expect(out.raw_prompt).toContain(REDACTED_ANTHROPIC);
    expect(out.raw_prompt).toContain(REDACTED_ABS_PATH);
    expect(out.raw_prompt).not.toContain("sk-ant-");
    expect(out.skills_loaded[0]).toBe("dusk/engineer/decoration-completeness");
    expect(out.nested.quote).toContain(REDACTED_ABS_PATH);
  });
});
