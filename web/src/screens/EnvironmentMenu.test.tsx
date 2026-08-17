import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentMenu } from "./EnvironmentMenu";
import type { EnvStatus } from "../api/types";

const RUNNING: EnvStatus = {
  phase: "running",
  services: [
    { service: "app", state: "running" },
    { service: "db", state: "starting" },
  ],
  openLinks: [{ label: "Open app", url: "https://app.example.com", service: "app" }],
};

function noop() {
  /* unused callback slot for a test that doesn't assert on it */
}

describe("EnvironmentMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when status is null", () => {
    const { container } = render(() => (
      <EnvironmentMenu
        status={null}
        isBusy={false}
        onRun={noop}
        onStop={noop}
        onReload={noop}
        onCancel={noop}
        onEditConfig={noop}
        onViewLogs={noop}
      />
    ));

    expect(container.querySelector(".tw-env-menu")).toBeNull();
  });

  it("renders nothing when the phase is unavailable", () => {
    const { container } = render(() => (
      <EnvironmentMenu
        status={{ phase: "unavailable" }}
        isBusy={false}
        onRun={noop}
        onStop={noop}
        onReload={noop}
        onCancel={noop}
        onEditConfig={noop}
        onViewLogs={noop}
      />
    ));

    expect(container.querySelector(".tw-env-menu")).toBeNull();
  });

  it("idle: clicking the toggle calls onRun, and Edit config is always available", () => {
    const onRun = vi.fn();
    const onEditConfig = vi.fn();
    render(() => (
      <EnvironmentMenu
        status={{ phase: "idle" }}
        isBusy={false}
        onRun={onRun}
        onStop={noop}
        onReload={noop}
        onCancel={noop}
        onEditConfig={onEditConfig}
        onViewLogs={noop}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Edit environment config" }));
    expect(onEditConfig).toHaveBeenCalledOnce();

    const toggle = document.querySelector(".tw-env-menu__toggle") as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(onRun).toHaveBeenCalledOnce();
  });

  it("starting: shows Setting up… with a cancel affordance, and Cancel calls onCancel", () => {
    const onCancel = vi.fn();
    render(() => (
      <EnvironmentMenu
        status={{ phase: "starting" }}
        isBusy={false}
        onRun={noop}
        onStop={noop}
        onReload={noop}
        onCancel={onCancel}
        onEditConfig={noop}
        onViewLogs={noop}
      />
    ));

    expect(screen.getByText("Setting up…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel environment setup" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("busy-before-poll-catches-up (idle + isBusy): shows Setting up… without a cancel affordance", () => {
    render(() => (
      <EnvironmentMenu
        status={{ phase: "idle" }}
        isBusy={true}
        onRun={noop}
        onStop={noop}
        onReload={noop}
        onCancel={noop}
        onEditConfig={noop}
        onViewLogs={noop}
      />
    ));

    expect(screen.getByText("Setting up…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel environment setup" })).toBeNull();
  });

  it("running: opens the dropdown, lists services, and reports onOpenChanged", () => {
    const onOpenChanged = vi.fn();
    render(() => (
      <EnvironmentMenu
        status={RUNNING}
        isBusy={false}
        onRun={noop}
        onStop={noop}
        onReload={noop}
        onCancel={noop}
        onEditConfig={noop}
        onViewLogs={noop}
        onOpenChanged={onOpenChanged}
      />
    ));

    expect(onOpenChanged).toHaveBeenCalledWith(false);
    expect(screen.getByText("1/2")).toBeInTheDocument();

    fireEvent.click(document.querySelector(".tw-env-menu__toggle") as HTMLButtonElement);

    expect(onOpenChanged).toHaveBeenCalledWith(true);
    expect(screen.getByText("Server running")).toBeInTheDocument();
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(screen.getByText("db")).toBeInTheDocument();
    expect(screen.getByText("starting")).toBeInTheDocument();
  });

  it("running: clicking a service's logs icon calls onViewLogs and closes the dropdown", () => {
    const onViewLogs = vi.fn();
    render(() => (
      <EnvironmentMenu
        status={RUNNING}
        isBusy={false}
        onRun={noop}
        onStop={noop}
        onReload={noop}
        onCancel={noop}
        onEditConfig={noop}
        onViewLogs={onViewLogs}
      />
    ));
    fireEvent.click(document.querySelector(".tw-env-menu__toggle") as HTMLButtonElement);

    fireEvent.click(screen.getByRole("button", { name: "View db logs" }));

    expect(onViewLogs).toHaveBeenCalledWith("db");
    expect(screen.queryByText("Server running")).toBeNull();
  });

  it("running: a service with a matching open link shows an external-link affordance that opens it in a new tab", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(() => (
      <EnvironmentMenu
        status={RUNNING}
        isBusy={false}
        onRun={noop}
        onStop={noop}
        onReload={noop}
        onCancel={noop}
        onEditConfig={noop}
        onViewLogs={noop}
      />
    ));
    fireEvent.click(document.querySelector(".tw-env-menu__toggle") as HTMLButtonElement);

    fireEvent.click(screen.getByRole("button", { name: "Open app in a new tab" }));

    expect(openSpy).toHaveBeenCalledWith("https://app.example.com", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  it("running: Stop environment calls onStop and closes the dropdown", () => {
    const onStop = vi.fn();
    render(() => (
      <EnvironmentMenu
        status={RUNNING}
        isBusy={false}
        onRun={noop}
        onStop={onStop}
        onReload={noop}
        onCancel={noop}
        onEditConfig={noop}
        onViewLogs={noop}
      />
    ));
    fireEvent.click(document.querySelector(".tw-env-menu__toggle") as HTMLButtonElement);

    fireEvent.click(screen.getByText("Stop environment"));

    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.queryByText("Server running")).toBeNull();
  });

  it("running: a pointerdown outside the menu closes the dropdown", () => {
    render(() => (
      <div>
        <div data-testid="outside" />
        <EnvironmentMenu
          status={RUNNING}
          isBusy={false}
          onRun={noop}
          onStop={noop}
        onReload={noop}
          onCancel={noop}
          onEditConfig={noop}
          onViewLogs={noop}
        />
      </div>
    ));
    fireEvent.click(document.querySelector(".tw-env-menu__toggle") as HTMLButtonElement);
    expect(screen.getByText("Server running")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId("outside"));

    expect(screen.queryByText("Server running")).toBeNull();
  });

  it("running: dropdown offers Reload and Reload with rebuild, wiring onReload(rebuild)", async () => {
    const onReload = vi.fn();
    render(() => (
      <EnvironmentMenu
        status={{ phase: "running", services: [{ service: "web", state: "running" }] }}
        isBusy={false}
        onRun={noop}
        onStop={noop}
        onReload={onReload}
        onCancel={noop}
        onEditConfig={noop}
        onViewLogs={noop}
      />
    ));

    fireEvent.click(document.querySelector(".tw-env-menu__toggle") as HTMLButtonElement);

    fireEvent.click(screen.getByRole("button", { name: /reload environment/i }));
    expect(onReload).toHaveBeenNthCalledWith(1, false);

    // Clicking a menu item closes the dropdown -- reopen for the second one.
    fireEvent.click(document.querySelector(".tw-env-menu__toggle") as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: /reload and rebuild/i }));
    expect(onReload).toHaveBeenNthCalledWith(2, true);
  });


  it("running: per-service reload/rebuild buttons wire onReload with the service name", () => {
    const onReload = vi.fn();
    render(() => (
      <EnvironmentMenu
        status={{ phase: "running", services: [{ service: "api", state: "running" }] }}
        isBusy={false}
        onRun={noop}
        onStop={noop}
        onReload={onReload}
        onCancel={noop}
        onEditConfig={noop}
        onViewLogs={noop}
      />
    ));

    fireEvent.click(document.querySelector(".tw-env-menu__toggle") as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: /Reload api \(restart only\)/i }));
    expect(onReload).toHaveBeenCalledWith(false, "api");

    fireEvent.click(document.querySelector(".tw-env-menu__toggle") as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: /Rebuild api \(rebuild image\)/i }));
    expect(onReload).toHaveBeenCalledWith(true, "api");
  });

});
