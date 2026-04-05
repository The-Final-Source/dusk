import { describe, it, expect } from "vitest";

import { parseAnnotation, extractAnnotations } from "./annotation.js";

describe("parseAnnotation", () => {
  it("parses a standard @dusk annotation", () => {
    const result = parseAnnotation("// @dusk auth-require-jwt");
    expect(result).toEqual({ constraintId: "auth-require-jwt" });
  });

  it("works with leading spaces", () => {
    const result = parseAnnotation("  // @dusk some_constraint");
    expect(result).toEqual({ constraintId: "some_constraint" });
  });

  it("works with leading tab", () => {
    const result = parseAnnotation("\t// @dusk tabbed");
    expect(result).toEqual({ constraintId: "tabbed" });
  });

  it("works with extra spaces around @dusk", () => {
    const result = parseAnnotation("//  @dusk  extra-spaces");
    expect(result).toEqual({ constraintId: "extra-spaces" });
  });

  it("returns null for non-annotation lines", () => {
    const result = parseAnnotation("const x = 5;");
    expect(result).toBeNull();
  });

  it("returns null for block comment style", () => {
    const result = parseAnnotation("/* @dusk block-comment */");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parseAnnotation("");
    expect(result).toBeNull();
  });
});

describe("extractAnnotations", () => {
  it("extracts annotations with correct 1-based line numbers", () => {
    const source = [
      "import { foo } from 'bar';",
      "// @dusk auth-require-jwt",
      "",
      "const x = 5;",
      "// @dusk no-direct-db",
    ].join("\n");

    const result = extractAnnotations(source);
    expect(result).toEqual([
      { constraintId: "auth-require-jwt", line: 2 },
      { constraintId: "no-direct-db", line: 5 },
    ]);
  });

  it("returns empty array when no annotations present", () => {
    const source = "const x = 5;\nconst y = 10;\n";
    const result = extractAnnotations(source);
    expect(result).toEqual([]);
  });
});
