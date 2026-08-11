import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvFileEditorStore } from "../stores/envFileEditorStore";
import { EnvFileEditorDialog } from "./EnvFileEditorDialog";

const FILES = [{ filename: "docker-compose.yml" }, { filename: "pre-run.sh" }];

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    listEnvFiles: vi.fn().mockResolvedValue(FILES),
    readEnvFile: vi.fn().mockResolvedValue("services:\n  app:\n    image: node"),
    writeEnvFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderDialog(overrides: Record<string, unknown> = {}) {
  const api = fakeApi(overrides);
  const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });
  const onDismiss = vi.fn();
  render(() => <EnvFileEditorDialog store={store} onDismiss={onDismiss} />);
  return { api, store, onDismiss };
}

describe("EnvFileEditorDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads file tabs and the first file's content on mount", async () => {
    renderDialog();

    expect(await screen.findByText("docker-compose.yml")).toBeInTheDocument();
    expect(screen.getByText("pre-run.sh")).toBeInTheDocument();
    // Not findByDisplayValue: its default whitespace normalizer mangles
    // comparisons against multi-line values (real newlines vs collapsed
    // whitespace) -- reading .value directly off the real <textarea>
    // (implicit role "textbox") sidesteps that entirely.
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("services:\n  app:\n    image: node"),
    );
  });

  it("shows the empty-state hint when the session has no env files", async () => {
    renderDialog({ listEnvFiles: vi.fn().mockResolvedValue([]) });

    expect(await screen.findByText("No .tmux-web-env/ files for this session.")).toBeInTheDocument();
  });

  it("switching tabs loads that file's content and clears prior save/error state", async () => {
    const api = fakeApi();
    api.readEnvFile.mockResolvedValueOnce("compose content").mockResolvedValueOnce("#!/bin/sh\nnpm install");
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });
    render(() => <EnvFileEditorDialog store={store} onDismiss={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("compose content"));

    fireEvent.click(screen.getByText("pre-run.sh"));

    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("#!/bin/sh\nnpm install"),
    );
    expect(api.readEnvFile).toHaveBeenLastCalledWith("p", "s", "pre-run.sh");
  });

  it("editing the textarea updates the draft, and Save writes it", async () => {
    const { api } = renderDialog();
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("services:\n  app:\n    image: node"),
    );
    const textarea = screen.getByRole("textbox");

    fireEvent.input(textarea, { target: { value: "services:\n  app:\n    image: node:22" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(api.writeEnvFile).toHaveBeenCalledWith("p", "s", "docker-compose.yml", "services:\n  app:\n    image: node:22");
    expect(await screen.findByText(/Saved docker-compose\.yml/)).toBeInTheDocument();
  });

  it("shows an error banner when loading fails", async () => {
    renderDialog({ listEnvFiles: vi.fn().mockRejectedValue(new Error("permission denied")) });

    expect(await screen.findByText("permission denied")).toBeInTheDocument();
  });

  it("Close editor calls onDismiss", async () => {
    const { onDismiss } = renderDialog();
    await screen.findByText("docker-compose.yml");

    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("clicking the scrim calls onDismiss, clicking inside the dialog does not", async () => {
    const { onDismiss } = renderDialog();
    await screen.findByText("docker-compose.yml");

    fireEvent.click(screen.getByText(".tmux-web-env"));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector(".tw-sheet-scrim")!);
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
