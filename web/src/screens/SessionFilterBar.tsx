// Ports kmp/.../ui/sessions/SessionFilterBar.kt. Status chips (All/Active/
// Idle -- "Active" = session.attached, "Idle" = !attached, no live
// docker-env status, deliberately) + a branch-name substring filter.
import type { SessionStatusFilter } from "../domain/sessionFilter";

export interface SessionFilterBarProps {
  statusFilter: SessionStatusFilter;
  onStatusFilterChange: (filter: SessionStatusFilter) => void;
  branchQuery: string;
  onBranchQueryChange: (query: string) => void;
}

const FILTERS: { value: SessionStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "idle", label: "Idle" },
];

function BranchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M4 2.5v6.2a2.3 2.3 0 002.3 2.3H8M4 2.5a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM11.6 3.8a1.3 1.3 0 11-2.6 0 1.3 1.3 0 012.6 0zM10.3 5.1v.9a2.3 2.3 0 01-2.3 2.3"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linecap="round"
      />
    </svg>
  );
}

export function SessionFilterBar(props: SessionFilterBarProps) {
  return (
    <div class="tw-filter-bar">
      <div class="tw-filter-bar__chips" role="group" aria-label="Filter by status">
        {FILTERS.map((filter) => (
          <button
            type="button"
            class="tw-filter-bar__chip"
            data-active={props.statusFilter === filter.value ? "true" : undefined}
            onClick={() => props.onStatusFilterChange(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div class="tw-filter-bar__branch">
        <span class="tw-filter-bar__branch-icon" aria-hidden="true">
          <BranchIcon />
        </span>
        <input
          class="tw-filter-bar__branch-input"
          value={props.branchQuery}
          placeholder="Filter by branch"
          aria-label="Filter by branch"
          onInput={(event) => props.onBranchQueryChange(event.currentTarget.value)}
        />
      </div>
    </div>
  );
}
