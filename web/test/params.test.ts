import { describe, expect, it } from "vitest";
import { parseOffset, parseSearch } from "../src/server.js";

describe("parseOffset", () => {
  it("parses a plain non-negative integer", () => {
    expect(parseOffset("0")).toBe(0);
    expect(parseOffset("25")).toBe(25);
  });

  it("defaults to 0 when absent or empty", () => {
    expect(parseOffset(null)).toBe(0);
    expect(parseOffset("")).toBe(0);
  });

  it("rejects negative, fractional, and non-numeric input as null", () => {
    // -1 must be null, NOT clamped to 0 (mutation-testing boundary).
    expect(parseOffset("-1")).toBeNull();
    expect(parseOffset("1.5")).toBeNull();
    expect(parseOffset("abc")).toBeNull();
    expect(parseOffset("  ")).toBeNull();
  });

  it("passes a huge value through as the integer", () => {
    expect(parseOffset("100000")).toBe(100000);
  });
});

describe("parseSearch", () => {
  it("returns the trimmed string", () => {
    expect(parseSearch("foo")).toBe("foo");
    expect(parseSearch("  foo  ")).toBe("foo");
  });

  it("returns null for absent or empty (incl. whitespace-only) input", () => {
    expect(parseSearch(null)).toBeNull();
    expect(parseSearch("")).toBeNull();
    expect(parseSearch("   ")).toBeNull();
  });

  it("truncates input to the 200-char cap", () => {
    const long = "a".repeat(250);
    expect(parseSearch(long)).toBe("a".repeat(200));
  });
});
