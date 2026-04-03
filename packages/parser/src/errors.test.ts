import { describe, expect, it } from "vitest";

import { formatErrors, type ParseError } from "./errors.js";

describe("formatErrors", () => {
  it("formats a single error with file and line", () => {
    const errors: ParseError[] = [
      {
        path: ["constraints", "0", "level"],
        message: "Invalid obligation level",
        code: "INVALID_LEVEL",
        file: "block.yaml",
        line: 12,
      },
    ];

    expect(formatErrors(errors)).toBe(
      "block.yaml:12 constraints.0.level: Invalid obligation level (INVALID_LEVEL)"
    );
  });

  it("formats multiple errors separated by newlines", () => {
    const errors: ParseError[] = [
      {
        path: ["name"],
        message: "Required",
        code: "REQUIRED",
        file: "intent.yaml",
        line: 1,
      },
      {
        path: ["version"],
        message: "Must be semver",
        code: "INVALID_VERSION",
        file: "intent.yaml",
        line: 3,
      },
    ];

    const result = formatErrors(errors);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("intent.yaml:1 name: Required (REQUIRED)");
    expect(lines[1]).toBe("intent.yaml:3 version: Must be semver (INVALID_VERSION)");
  });

  it("omits location when file is not provided", () => {
    const errors: ParseError[] = [
      {
        path: ["name"],
        message: "Required",
        code: "REQUIRED",
      },
    ];

    expect(formatErrors(errors)).toBe("name: Required (REQUIRED)");
  });

  it("omits path prefix when path is empty", () => {
    const errors: ParseError[] = [
      {
        path: [],
        message: "Invalid YAML",
        code: "PARSE_ERROR",
        file: "block.yaml",
      },
    ];

    expect(formatErrors(errors)).toBe("block.yaml Invalid YAML (PARSE_ERROR)");
  });

  it("returns empty string for empty array", () => {
    expect(formatErrors([])).toBe("");
  });
});
