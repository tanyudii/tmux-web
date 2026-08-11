import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnectionSettingsStore } from "../stores/connectionSettingsStore";
import { ConnectScreen } from "./ConnectScreen";

describe("ConnectScreen", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("lets the user type a server URL and token and connect", async () => {
    const testConnection = vi.fn().mockResolvedValue(undefined);
    const store = createConnectionSettingsStore({ testConnection, defaultServerUrl: () => null });
    render(() => <ConnectScreen store={store} />);

    fireEvent.input(screen.getByLabelText("Server URL"), { target: { value: "https://tmux.example.com" } });
    fireEvent.input(screen.getByLabelText("Access token"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(testConnection).toHaveBeenCalledWith({ baseUrl: "https://tmux.example.com", token: "secret" });
  });

  it("disables the Connect button until both fields are filled", () => {
    const store = createConnectionSettingsStore({ defaultServerUrl: () => null });
    render(() => <ConnectScreen store={store} />);

    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the server error message when the connection test fails", async () => {
    const testConnection = vi.fn().mockRejectedValue(new Error("Token is invalid or expired."));
    const store = createConnectionSettingsStore({ testConnection, defaultServerUrl: () => null });
    render(() => <ConnectScreen store={store} />);

    fireEvent.input(screen.getByLabelText("Server URL"), { target: { value: "https://tmux.example.com" } });
    fireEvent.input(screen.getByLabelText("Access token"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(await screen.findByText("Token is invalid or expired.")).toBeInTheDocument();
  });

  it("shows the paste-restricted helper only when there is no error and the context is insecure", () => {
    const store = createConnectionSettingsStore({ isSecureContext: () => false, defaultServerUrl: () => null });
    render(() => <ConnectScreen store={store} />);

    expect(screen.getByText(/Clipboard paste isn't available/)).toBeInTheDocument();
  });
});
