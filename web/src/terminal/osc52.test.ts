import { describe, expect, it } from "vitest";
import { decodeOsc52, OSC_52_IDENT } from "./osc52";

const base64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe("decodeOsc52", () => {
  it("uses the OSC identifier the clipboard sequence is defined for", () => {
    expect(OSC_52_IDENT).toBe(52);
  });

  it("decodes a clipboard set targeted at the clipboard selection", () => {
    expect(decodeOsc52(`c;${base64("hello world")}`)).toBe("hello world");
  });

  it("accepts any selection target, since a browser only has one clipboard", () => {
    expect(decodeOsc52(`p;${base64("primary")}`)).toBe("primary");
    expect(decodeOsc52(`s0;${base64("select")}`)).toBe("select");
    expect(decodeOsc52(`;${base64("empty target")}`)).toBe("empty target");
  });

  it("decodes multi-line payloads intact", () => {
    const text = "line one\nline two\n";
    expect(decodeOsc52(`c;${base64(text)}`)).toBe(text);
  });

  // atob alone yields latin1 bytes, which turns any non-ASCII character into
  // mojibake -- the payload is UTF-8 and has to be decoded as such.
  it("decodes UTF-8 rather than latin1", () => {
    const text = "não · 你好 · ┌─┐";
    expect(decodeOsc52(`c;${base64(text)}`)).toBe(text);
  });

  // Answering a read would let any process in the terminal exfiltrate the
  // page's clipboard. Never respond to one.
  it("refuses a clipboard READ request", () => {
    expect(decodeOsc52("c;?")).toBeNull();
  });

  it("ignores an empty payload", () => {
    expect(decodeOsc52("c;")).toBeNull();
  });

  it("ignores a payload with no selection-target separator", () => {
    expect(decodeOsc52("garbage")).toBeNull();
  });

  it("returns null instead of throwing on invalid base64", () => {
    expect(decodeOsc52("c;!!!not base64!!!")).toBeNull();
  });
});
