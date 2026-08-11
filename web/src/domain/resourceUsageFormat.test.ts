import { describe, expect, it } from "vitest";
import { formatResourceUsageBadge } from "./resourceUsageFormat";

describe("formatResourceUsageBadge", () => {
  it("returns null while the first poll is still in flight (usage === null)", () => {
    expect(formatResourceUsageBadge(null)).toBeNull();
  });

  it("returns 'N/A' for a session that never opted into a compose environment", () => {
    expect(formatResourceUsageBadge({ available: false, services: [] })).toBe("N/A");
  });

  it("sums CPU% and memory bytes across every container", () => {
    const usage = {
      available: true,
      services: [
        { service: "app", cpuPercent: 12.4, memUsageBytes: 100_000_000, memLimitBytes: 1e9 },
        { service: "db", cpuPercent: 3.1, memUsageBytes: 50_000_000, memLimitBytes: 1e9 },
      ],
    };

    expect(formatResourceUsageBadge(usage)).toBe("15% · 143MB");
  });

  it("formats memory in GB once it crosses 1024MB, truncated to one decimal place", () => {
    const usage = { available: true, services: [{ service: "app", cpuPercent: 0, memUsageBytes: 1_500_000_000, memLimitBytes: 1e10 }] };

    // 1_500_000_000 bytes ~= 1430.51MB ~= 1.397GB, truncated (not rounded) to 1.3GB.
    expect(formatResourceUsageBadge(usage)).toBe("0% · 1.3GB");
  });

  it("available with zero services sums to 0% · 0MB", () => {
    expect(formatResourceUsageBadge({ available: true, services: [] })).toBe("0% · 0MB");
  });
});
