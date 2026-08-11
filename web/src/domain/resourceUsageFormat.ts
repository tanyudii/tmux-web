// Ports WebMainPane.kt's ResourceUsageBadge/formatCpuPercent/formatMemBytes
// (EMB-214). Concise "CPU% · memMB" summary (aggregated across every
// container in the session's compose environment), "N/A" for a session
// that never opted into one, null while the first poll is still in flight
// (usage === null) so the caller can render nothing rather than flashing a
// placeholder -- see SessionResourceUsageStore's own doc comment for why
// that's the store's job, not this formatter's.
import type { SessionResourceUsage } from "../api/types";

const BYTES_PER_KIB = 1024;
const KIB_PER_MIB = 1024;
const MIB_PER_GIB = 1024;
const GIB_ROUNDING_FACTOR = 10;

function formatCpuPercent(percent: number): string {
  return `${Math.trunc(percent)}%`;
}

// Truncates (not rounds) to one decimal place once memory crosses 1024MB --
// matches the Kotlin original's `.toInt()` truncation exactly, not a round.
function formatMemBytes(bytes: number): string {
  const megabytes = bytes / (BYTES_PER_KIB * KIB_PER_MIB);
  if (megabytes < MIB_PER_GIB) return `${Math.trunc(megabytes)}MB`;
  const gigabytes = Math.trunc((megabytes / MIB_PER_GIB) * GIB_ROUNDING_FACTOR) / GIB_ROUNDING_FACTOR;
  return `${gigabytes}GB`;
}

export function formatResourceUsageBadge(usage: SessionResourceUsage | null): string | null {
  if (usage === null) return null;
  if (!usage.available) return "N/A";
  const totalCpu = usage.services.reduce((sum, s) => sum + s.cpuPercent, 0);
  const totalMemBytes = usage.services.reduce((sum, s) => sum + s.memUsageBytes, 0);
  return `${formatCpuPercent(totalCpu)} · ${formatMemBytes(totalMemBytes)}`;
}
