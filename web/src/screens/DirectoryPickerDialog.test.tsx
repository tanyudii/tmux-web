import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDirectoryPickerStore } from "../stores/directoryPickerStore";
import { DirectoryPickerDialog } from "./DirectoryPickerDialog";

const ROOT_LISTING = {
  path: "/home/user",
  parentPath: "/home",
  isGitRepo: false,
  entries: [
    { name: "my-app", path: "/home/user/my-app", isGitRepo: true },
    { name: "docs", path: "/home/user/docs", isGitRepo: false },
  ],
  truncated: false,
};

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    browseDirectory: vi.fn().mockResolvedValue(ROOT_LISTING),
    ...overrides,
  };
}

function renderDialog(overrides: Record<string, unknown> = {}) {
  const api = fakeApi(overrides);
  const store = createDirectoryPickerStore({ api });
  const onPicked = vi.fn();
  const onCancel = vi.fn();
  render(() => <DirectoryPickerDialog store={store} onPicked={onPicked} onCancel={onCancel} />);
  return { api, store, onPicked, onCancel };
}

describe("DirectoryPickerDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("loads and lists entries on mount, with a git badge only on git repos", async () => {
    renderDialog();

    expect(await screen.findByText("my-app")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getAllByText("git")).toHaveLength(1);
  });

  it("disables 'Use this folder' until the current directory is a git repo", async () => {
    renderDialog();
    await screen.findByText("my-app");

    expect((screen.getByRole("button", { name: "Use this folder" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables 'Use this folder' and confirms with the current path once it is a git repo", async () => {
    const api = fakeApi();
    api.browseDirectory
      .mockResolvedValueOnce(ROOT_LISTING)
      .mockResolvedValueOnce({ path: "/home/user/my-app", parentPath: "/home/user", isGitRepo: true, entries: [], truncated: false });
    const store = createDirectoryPickerStore({ api });
    const onPicked = vi.fn();
    render(() => <DirectoryPickerDialog store={store} onPicked={onPicked} onCancel={vi.fn()} />);
    await screen.findByText("my-app");

    fireEvent.click(screen.getByText("my-app"));
    await screen.findByText("No subfolders here.");

    const confirmButton = screen.getByRole("button", { name: "Use this folder" }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);
    expect(onPicked).toHaveBeenCalledWith("/home/user/my-app");
  });

  it("'Up one level' is enabled when parentPath exists and loads it", async () => {
    const { api } = renderDialog();
    await screen.findByText("my-app");

    const upButton = screen.getByRole("button", { name: "Up one level" }) as HTMLButtonElement;
    expect(upButton.disabled).toBe(false);

    fireEvent.click(upButton);

    expect(api.browseDirectory).toHaveBeenLastCalledWith(ROOT_LISTING.parentPath);
  });

  it("'Up one level' is disabled when there is no parentPath", async () => {
    renderDialog({ browseDirectory: vi.fn().mockResolvedValue({ ...ROOT_LISTING, parentPath: null }) });
    await screen.findByText("my-app");

    expect((screen.getByRole("button", { name: "Up one level" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows an error with a working Retry, which re-issues the last request", async () => {
    const api = fakeApi();
    api.browseDirectory.mockResolvedValueOnce(ROOT_LISTING).mockRejectedValueOnce(new Error("permission denied"));
    const store = createDirectoryPickerStore({ api });
    render(() => <DirectoryPickerDialog store={store} onPicked={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByText("my-app");

    fireEvent.click(screen.getByText("my-app"));
    expect(await screen.findByText("permission denied")).toBeInTheDocument();

    api.browseDirectory.mockResolvedValueOnce({ path: "/home/user/my-app", parentPath: "/home/user", isGitRepo: true, entries: [], truncated: false });
    fireEvent.click(screen.getByText("Retry"));

    expect(await screen.findByText("No subfolders here.")).toBeInTheDocument();
  });

  it("Cancel calls onCancel without picking a path", async () => {
    const { onCancel, onPicked } = renderDialog();
    await screen.findByText("my-app");

    fireEvent.click(screen.getByText("Cancel"));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onPicked).not.toHaveBeenCalled();
  });

  it("shows the truncated hint when the listing was truncated", async () => {
    renderDialog({ browseDirectory: vi.fn().mockResolvedValue({ ...ROOT_LISTING, truncated: true }) });

    expect(await screen.findByText(/Showing the first entries only/)).toBeInTheDocument();
  });
});
