import { describe, expect, test } from "vitest";
import { parseServerUrl } from "./serverUrl";

// Ports kmp/.../domain/ServerUrlTest.kt 1:1.
describe("parseServerUrl", () => {
  test("accepts http URL with host and port", () => {
    expect(parseServerUrl("http://192.168.1.5:5309")).toBe("http://192.168.1.5:5309");
  });

  test("accepts https URL", () => {
    expect(parseServerUrl("https://tmux.example.com")).toBe("https://tmux.example.com");
  });

  test("trims surrounding whitespace", () => {
    expect(parseServerUrl("  http://host:5309  ")).toBe("http://host:5309");
  });

  test("drops a path suffix", () => {
    expect(parseServerUrl("http://host:5309/some/path")).toBe("http://host:5309");
  });

  test("rejects a scheme-less string", () => {
    expect(parseServerUrl("host:5309")).toBeNull();
  });

  test("rejects a scheme with no host", () => {
    expect(parseServerUrl("http://")).toBeNull();
  });

  test("rejects a non-http scheme", () => {
    expect(parseServerUrl("ftp://host")).toBeNull();
  });

  test("rejects blank input", () => {
    expect(parseServerUrl("")).toBeNull();
  });
});
