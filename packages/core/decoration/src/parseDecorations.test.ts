import { describe, test, expect } from "vitest";

import { parseDecorations } from "./parseDecorations.js";

const SOURCE = `// @intent-file api/foo [shape, exports]
import { x } from "y";

// @intent notifications/send [persist-first, publish-sync]
export async function sendNotification() {
  // @intent-support notifications/send [persist-first] ["the row builder", "constructs", "a notification row per target user"]
  const rows = build();

  // @intent-test notifications/send/unit-tests [covers-persist-first]
  test("persists first", () => {});

  // @intent-ignore api/generated because=(this-file, is-generated-by, openapi-gen) reason="Generated; do not edit."
  const generated = 1;
}

// @intent-test-file notifications/send/unit-tests
`;

describe("parseDecorations (P1-T8)", () => {
  const records = parseDecorations(SOURCE, "x.ts");

  test("produces one record per marker occurrence (all six markers)", () => {
    expect(records.map((r) => r.marker).sort()).toEqual(
      ["intent", "intent-file", "intent-ignore", "intent-support", "intent-test", "intent-test-file"].sort(),
    );
  });

  test("captures intent_path, aspect_ids, and file:line", () => {
    const focal = records.find((r) => r.marker === "intent");
    expect(focal?.intent_path).toBe("notifications/send");
    expect(focal?.aspect_ids).toEqual(["persist-first", "publish-sync"]);
    expect(focal?.line).toBe(4);
    expect(focal?.scope).toBe("declaration");
    expect(focal?.declaration_name).toBe("sendNotification");
  });

  test("captures the inline support triple", () => {
    const support = records.find((r) => r.marker === "intent-support");
    expect(support?.support_triple).toEqual(["the row builder", "constructs", "a notification row per target user"]);
    expect(support?.aspect_ids).toEqual(["persist-first"]);
  });

  test("captures the @intent-ignore because/reason clause", () => {
    const ignore = records.find((r) => r.marker === "intent-ignore");
    expect(ignore?.ignore_clause).toEqual({
      because: ["this-file", "is-generated-by", "openapi-gen"],
      reason: "Generated; do not edit.",
    });
  });

  test("file-scope markers resolve to file scope", () => {
    expect(records.find((r) => r.marker === "intent-file")?.scope).toBe("file");
    expect(records.find((r) => r.marker === "intent-test-file")?.scope).toBe("file");
  });

  // D.28 additive fields — existing inline records are unaffected (default
  // `anchor: null`, `verify: "semantic"`).
  test("inline records default anchor:null and verify:semantic", () => {
    for (const r of records) {
      expect(r.anchor ?? null).toBeNull();
      expect(r.verify ?? "semantic").toBe("semantic");
    }
  });
});
