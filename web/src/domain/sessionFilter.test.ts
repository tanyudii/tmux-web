import { describe, expect, test } from "vitest";
import type { ProjectSession } from "../api/types";
import { filterSessions } from "./sessionFilter";

// Ports kmp/.../domain/SessionFilterTest.kt 1:1.
function session(name: string, attached: boolean): ProjectSession {
  return { name, fullName: `proj__${name}`, windows: 1, windowNames: [], attached, label: null, favorite: false };
}

describe("filterSessions", () => {
  test("ALL status with empty query returns every session", () => {
    const sessions = [session("feature-a", true), session("feature-b", false)];

    const result = filterSessions(sessions, "all", "");

    expect(result).toEqual(sessions);
  });

  test("ACTIVE status filter keeps only attached sessions", () => {
    const active = session("feature-a", true);
    const idle = session("feature-b", false);

    const result = filterSessions([active, idle], "active", "");

    expect(result).toEqual([active]);
  });

  test("IDLE status filter keeps only detached sessions", () => {
    const active = session("feature-a", true);
    const idle = session("feature-b", false);

    const result = filterSessions([active, idle], "idle", "");

    expect(result).toEqual([idle]);
  });

  test("branch query matches case-insensitively as a substring", () => {
    const target = session("Feature-Login", true);
    const other = session("bugfix-nav", true);

    const result = filterSessions([target, other], "all", "login");

    expect(result).toEqual([target]);
  });

  test("blank branch query is treated as no filter", () => {
    const sessions = [session("feature-a", true), session("feature-b", false)];

    const result = filterSessions(sessions, "all", "   ");

    expect(result).toEqual(sessions);
  });

  test("status and branch filters combine with AND semantics", () => {
    const match = session("feature-login", true);
    const wrongStatus = session("feature-logout", false);
    const wrongBranch = session("bugfix-nav", true);

    const result = filterSessions([match, wrongStatus, wrongBranch], "active", "feature");

    expect(result).toEqual([match]);
  });

  test("no matches returns an empty list", () => {
    const sessions = [session("feature-a", true)];

    const result = filterSessions(sessions, "all", "nonexistent");

    expect(result).toEqual([]);
  });
});
