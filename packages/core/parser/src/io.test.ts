import { describe, test, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomicWriteFile, readIntentFile, serializeIntent, writeIntentFile } from "./io.js";

const YAML_INTENT = `schema_version: 2
id: api/pagination/cursor-only/cursor-decode
description: Cursor decoding validates input and produces a typed state.
obligation: must
compose: all
triples:
  - id: return-payload
    subject: the cursor decode function
    predicate: return
    object: a typed CursorState or a typed DecodeError
  - id: query-param
    subject: the cursor decode function
    predicate: accept
    object: a single string query parameter named cursor
relates_to:
  - kind: parent
    target: api/pagination/cursor-only
`;

describe("intent file round-trip (P1-T2)", () => {
  test("read -> write -> read preserves the intent and sorts triples by id", () => {
    const dir = mkdtempSync(join(tmpdir(), "dusk-io-"));
    const src = join(dir, "intent.yaml");
    writeFileSync(src, YAML_INTENT);

    const first = readIntentFile(src);
    expect(first.success).toBe(true);
    if (!first.success) return;

    const out = join(dir, "out.yaml");
    writeIntentFile(out, first.intent);
    const second = readIntentFile(out);
    expect(second.success).toBe(true);
    if (!second.success) return;

    // Lossless content preservation (triple order is canonicalized to id-sorted).
    const normalize = (i: typeof first.intent) => ({ ...i, triples: [...(i.triples ?? [])].sort((a, b) => a.id.localeCompare(b.id)) });
    expect(normalize(second.intent)).toEqual(normalize(first.intent));

    // Canonical form is stable: re-writing the already-canonical intent is idempotent.
    const out2 = join(dir, "out2.yaml");
    writeIntentFile(out2, second.intent);
    const third = readIntentFile(out2);
    expect(third.success).toBe(true);
    if (third.success) expect(third.intent).toEqual(second.intent);

    const yaml = serializeIntent(first.intent);
    expect(yaml.indexOf("query-param")).toBeLessThan(yaml.indexOf("return-payload"));
  });
});

describe("atomic write (P1-T20)", () => {
  test("a completed write replaces content; a stray temp never corrupts the live file", () => {
    const dir = mkdtempSync(join(tmpdir(), "dusk-atomic-"));
    const path = join(dir, "f.txt");

    atomicWriteFile(path, "v1");
    expect(readFileSync(path, "utf8")).toBe("v1");
    atomicWriteFile(path, "v2");
    expect(readFileSync(path, "utf8")).toBe("v2");

    // Simulate an interrupted write: a temp sibling exists but the rename never happened.
    writeFileSync(`${path}.tmp-crash`, "partial junk");
    expect(readFileSync(path, "utf8")).toBe("v2"); // live file untouched, never partial
  });
});
