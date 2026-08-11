import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccessLogStore } from "../stores/accessLogStore";
import { AccessLogDialog } from "./AccessLogDialog";

const ENTRY_A = { timestamp: "2026-01-01T00:00:00Z", ip: "127.0.0.1", method: "GET", path: "/api/projects", outcome: "authorized" };
const ENTRY_B = { timestamp: "2026-01-01T00:01:00Z", ip: "10.0.0.5", method: "GET", path: "/api/projects", outcome: "denied" };

describe("AccessLogDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads and lists entries on mount, styling denied outcomes differently", async () => {
    const api = { getAccessLog: vi.fn().mockResolvedValue([ENTRY_A, ENTRY_B]) };
    const store = createAccessLogStore({ api });
    render(() => <AccessLogDialog store={store} onDismiss={vi.fn()} />);

    expect(await screen.findByText("authorized")).toBeInTheDocument();
    expect(screen.getByText("denied")).toBeInTheDocument();
    expect(screen.getByText("GET /api/projects · 127.0.0.1")).toBeInTheDocument();
  });

  it("shows the empty state when there are no entries", async () => {
    const store = createAccessLogStore({ api: { getAccessLog: vi.fn().mockResolvedValue([]) } });
    render(() => <AccessLogDialog store={store} onDismiss={vi.fn()} />);

    expect(await screen.findByText("No access recorded yet.")).toBeInTheDocument();
  });

  it("shows an error banner on failure", async () => {
    const store = createAccessLogStore({ api: { getAccessLog: vi.fn().mockRejectedValue(new Error("unreachable")) } });
    render(() => <AccessLogDialog store={store} onDismiss={vi.fn()} />);

    expect(await screen.findByText("unreachable")).toBeInTheDocument();
  });

  it("Refresh re-fetches, Close and scrim-click both call onDismiss", async () => {
    const api = { getAccessLog: vi.fn().mockResolvedValue([ENTRY_A]) };
    const store = createAccessLogStore({ api });
    const onDismiss = vi.fn();
    render(() => <AccessLogDialog store={store} onDismiss={onDismiss} />);
    await screen.findByText("authorized");

    fireEvent.click(screen.getByText("Refresh"));
    expect(api.getAccessLog).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText("Access log"));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".tw-sheet-scrim")!);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
