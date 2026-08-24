import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnectionSettingsStore } from "../stores/connectionSettingsStore";
import { ConnectScreen } from "./ConnectScreen";

function makeStore(overrides: Parameters<typeof createConnectionSettingsStore>[0] = {}) {
  return createConnectionSettingsStore({ defaultServerUrl: () => null, ...overrides });
}

describe("ConnectScreen", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("lets the user type a server URL and credentials and connect", async () => {
    const login = vi.fn().mockResolvedValue("issued-token");
    const store = makeStore({ login });
    render(() => <ConnectScreen store={store} />);

    fireEvent.input(screen.getByLabelText("Server URL"), { target: { value: "https://tmux.example.com" } });
    fireEvent.input(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(login).toHaveBeenCalledWith({ baseUrl: "https://tmux.example.com", username: "alice", password: "secret" });
  });

  it("disables the Connect button until all fields are filled", () => {
    const store = makeStore();
    render(() => <ConnectScreen store={store} />);

    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server error message when the login fails", async () => {
    const login = vi.fn().mockRejectedValue(new Error("Invalid username or password."));
    const store = makeStore({ login });
    render(() => <ConnectScreen store={store} />);

    fireEvent.input(screen.getByLabelText("Server URL"), { target: { value: "https://tmux.example.com" } });
    fireEvent.input(screen.getByLabelText("Username"), { target: { value: "alice" } });
    fireEvent.input(screen.getByLabelText("Password"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(await screen.findByText("Invalid username or password.")).toBeInTheDocument();
  });

  it("shows the paste-restricted helper only when there is no error and the context is insecure", () => {
    const store = makeStore({ isSecureContext: () => false });
    render(() => <ConnectScreen store={store} />);

    expect(screen.getByText(/Clipboard paste isn't available/)).toBeInTheDocument();
  });
});
