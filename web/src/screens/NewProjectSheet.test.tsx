import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewProjectSheet } from "./NewProjectSheet";

const GIT_REPO_LISTING = {
  path: "/home/user/my-app",
  parentPath: "/home/user",
  isGitRepo: true,
  entries: [],
  truncated: false,
};

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    browseDirectory: vi.fn().mockResolvedValue(GIT_REPO_LISTING),
    ...overrides,
  };
}

describe("NewProjectSheet", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a placeholder repo-path field that has no text input", () => {
    render(() => (
      <NewProjectSheet state={{ isSaving: false, errorMessage: null }} api={fakeApi()} onSave={vi.fn()} onCancel={vi.fn()} />
    ));

    expect(screen.getByText("Choose a folder…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Repo path")).toBeNull(); // no <input> -- it's a button now
  });

  it("clicking the repo-path field opens DirectoryPickerDialog, and picking a path fills the field", async () => {
    const api = fakeApi();
    render(() => (
      <NewProjectSheet state={{ isSaving: false, errorMessage: null }} api={api} onSave={vi.fn()} onCancel={vi.fn()} />
    ));

    fireEvent.click(screen.getByText("Choose a folder…"));
    expect(await screen.findByText("Choose a folder")).toBeInTheDocument(); // dialog header

    // "Use this folder" starts disabled until the picker's own initial
    // listing resolves and confirms the folder is a git repo -- wait for
    // that resolution (GIT_REPO_LISTING has no entries) before clicking.
    await screen.findByText("No subfolders here.");
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));

    expect(await screen.findByText("/home/user/my-app")).toBeInTheDocument();
    expect(screen.queryByText("Choose a folder…")).toBeNull();
  });

  it("cancelling the picker leaves the repo path empty", async () => {
    render(() => (
      <NewProjectSheet state={{ isSaving: false, errorMessage: null }} api={fakeApi()} onSave={vi.fn()} onCancel={vi.fn()} />
    ));

    fireEvent.click(screen.getByText("Choose a folder…"));
    await screen.findByText("Choose a folder");
    // Two "Cancel" buttons are on screen at once here: the Sheet's own
    // header Cancel, and the DirectoryPickerDialog's footer Cancel -- the
    // dialog is rendered second, so it's the last match.
    const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);

    expect(screen.getByText("Choose a folder…")).toBeInTheDocument();
  });

  it("onSave is called with the trimmed name and picked repo path", async () => {
    const onSave = vi.fn();
    render(() => (
      <NewProjectSheet state={{ isSaving: false, errorMessage: null }} api={fakeApi()} onSave={onSave} onCancel={vi.fn()} />
    ));

    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "  my-app  " } });
    fireEvent.click(screen.getByText("Choose a folder…"));
    await screen.findByText("Choose a folder");
    await screen.findByText("No subfolders here.");
    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    await screen.findByText("/home/user/my-app");

    fireEvent.click(screen.getByText("Add"));

    expect(onSave).toHaveBeenCalledWith("my-app", "/home/user/my-app");
  });
});
