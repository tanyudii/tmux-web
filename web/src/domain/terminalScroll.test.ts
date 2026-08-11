import { describe, expect, test } from "vitest";
import { accumulateScrollLines } from "./terminalScroll";

// Ports kmp/.../domain/TerminalScrollTest.kt 1:1.
describe("accumulateScrollLines", () => {
  test("reports no lines and keeps the carry when the terminal has no laid-out height yet", () => {
    // Arrange: pixelsPerLine <= 0 is the "not fitted yet" case.
    const carry = 0.4;

    // Act
    const result = accumulateScrollLines(100, 0, carry);

    // Assert
    expect(result.lines).toBe(0);
    expect(result.carry).toBe(carry);
  });

  test("reports no lines for a drag shorter than a single line", () => {
    // Arrange / Act: 7px of an 18px line.
    const result = accumulateScrollLines(7, 18, 0);

    // Assert
    expect(result.lines).toBe(0);
    expect(result.carry).toBeGreaterThan(0);
  });

  test("accumulates successive sub-line drags until they cross a line boundary", () => {
    // Arrange: three 7px steps over an 18px line = 21px, i.e. one whole line.
    let carry = 0;
    const reported: number[] = [];

    // Act
    for (let i = 0; i < 3; i++) {
      const result = accumulateScrollLines(7, 18, carry);
      carry = result.carry;
      if (result.lines !== 0) reported.push(result.lines);
    }

    // Assert: a slow drag must eventually scroll, not silently do nothing.
    expect(reported).toEqual([1]);
  });

  test("a positive delta scrolls down and a negative delta scrolls up", () => {
    // Arrange / Act
    const down = accumulateScrollLines(36, 18, 0);
    const up = accumulateScrollLines(-36, 18, 0);

    // Assert
    expect(down.lines).toBe(2);
    expect(up.lines).toBe(-2);
  });

  test("subtracts only the reported whole lines so the leftover fraction is not lost", () => {
    // Arrange / Act: 45px over an 18px line = 2.5 lines.
    const result = accumulateScrollLines(45, 18, 0);

    // Assert: 2 lines reported, half a line carried -- not reset to zero.
    expect(result.lines).toBe(2);
    expect(Math.abs(result.carry - 0.5)).toBeLessThan(1e-9);
  });

  test("does not drift over a long continuous drag", () => {
    // Arrange: 100 steps of exactly one line each.
    let carry = 0;
    let total = 0;

    // Act
    for (let i = 0; i < 100; i++) {
      const result = accumulateScrollLines(18, 18, carry);
      carry = result.carry;
      total += result.lines;
    }

    // Assert: 100 lines of gesture must report exactly 100 lines of scroll.
    expect(total).toBe(100);
  });
});
