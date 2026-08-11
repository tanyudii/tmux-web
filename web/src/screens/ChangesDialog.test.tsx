import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChangesStore } from "../stores/changesStore";
import { ChangesDialog } from "./ChangesDialog";

const STAGED_FILE = { path: "src/a.ts", status: "modified" as const, staged: true, conflicted: false };
const UNSTAGED_FILE = { path: "src/b.ts", status: "added" as const, staged: false, conflicted: false };

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    getChanges: vi.fn().mockResolvedValue({
      staged: [STAGED_FILE],
      unstaged: [UNSTAGED_FILE],
      untracked: [],
      conflicted: [],
      repoState: "clean",
    }),
    getDiff: vi.fn().mockResolvedValue({ diff: "@@ -1 +1 @@\n-old\n+new\n", isUntracked: false, isBinary: false }),
    stageFile: vi.fn().mockResolvedValue(undefined),
    unstageFile: vi.fn().mockResolvedValue(undefined),
    discardFile: vi.fn().mockResolvedValue(undefined),
    commitChanges: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function renderDialog(overrides: Record<string, unknown> = {}) {
  const api = fakeApi(overrides);
  const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });
  await store.refresh();
  const onClose = vi.fn();
  render(() => <ChangesDialog store={store} onClose={onClose} />);
  return { store, api, onClose };
}

describe("ChangesDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders Staged and Changes sections with their files", async () => {
    await renderDialog();

    expect(screen.getByText(/Staged \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Changes \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
  });

  it("calls onClose from the back control", async () => {
    const { onClose } = await renderDialog();

    fireEvent.click(screen.getByRole("button", { name: /Close/ }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stages an unstaged file and unstages a staged one", async () => {
    const { api } = await renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Stage src/b.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "Unstage src/a.ts" }));

    expect(api.stageFile).toHaveBeenCalledWith("p", "s", "src/b.ts");
    expect(api.unstageFile).toHaveBeenCalledWith("p", "s", "src/a.ts");
  });

  it("discard flow asks for confirmation before calling the API", async () => {
    const { api } = await renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Discard src/a.ts" }));
    expect(screen.getByText(/Discard changes to src\/a\.ts/)).toBeInTheDocument();
    expect(api.discardFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await Promise.resolve();

    expect(api.discardFile).toHaveBeenCalledWith("p", "s", "src/a.ts", "staged");
  });

  it("opens a file's diff and renders parsed add/delete lines", async () => {
    await renderDialog();

    fireEvent.click(screen.getByText("src/a.ts"));
    await Promise.resolve();
    await Promise.resolve();

    expect(await screen.findByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("disables Commit until there is a message and at least one staged file", async () => {
    await renderDialog();

    const commitButton = screen.getByRole("button", { name: "Commit" }) as HTMLButtonElement;
    expect(commitButton.disabled).toBe(true);

    fireEvent.input(screen.getByPlaceholderText("Commit message"), { target: { value: "fix bug" } });
    expect((screen.getByRole("button", { name: "Commit" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
