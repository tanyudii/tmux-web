import { afterEach, describe, expect, it, vi } from "vitest";
import { createChangesStore } from "./changesStore";

const FILE_A = { path: "a.ts", status: "modified" as const, staged: false, conflicted: false };
const GROUPED = { staged: [], unstaged: [FILE_A], untracked: [], conflicted: [], repoState: "clean" as const };

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    getChanges: vi.fn().mockResolvedValue(GROUPED),
    getDiff: vi.fn(),
    stageFile: vi.fn().mockResolvedValue(undefined),
    unstageFile: vi.fn().mockResolvedValue(undefined),
    discardFile: vi.fn().mockResolvedValue(undefined),
    commitChanges: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createChangesStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refresh() loads grouped changes", async () => {
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api: fakeApi() });

    await store.refresh();

    expect(store.state.changes).toEqual(GROUPED);
  });

  it("start() fetches immediately and then polls every 5s until stop()", async () => {
    vi.useFakeTimers();
    const api = fakeApi();
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });

    store.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getChanges).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(api.getChanges).toHaveBeenCalledTimes(2);

    store.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(api.getChanges).toHaveBeenCalledTimes(2);
  });

  it("stage/unstage call the API then refresh", async () => {
    const api = fakeApi();
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });

    await store.stage(FILE_A);
    expect(api.stageFile).toHaveBeenCalledWith("p", "s", "a.ts");
    expect(api.getChanges).toHaveBeenCalledOnce();

    await store.unstage(FILE_A);
    expect(api.unstageFile).toHaveBeenCalledWith("p", "s", "a.ts");
  });

  it("discard flow: request -> cancel clears the prompt without calling the API", () => {
    const api = fakeApi();
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });

    store.requestDiscard(FILE_A, "unstaged");
    expect(store.state.pendingDiscard).toEqual({ file: FILE_A, mode: "unstaged" });

    store.cancelDiscard();
    expect(store.state.pendingDiscard).toBeNull();
    expect(api.discardFile).not.toHaveBeenCalled();
  });

  it("discard flow: confirm discards and refreshes", async () => {
    const api = fakeApi();
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });
    store.requestDiscard(FILE_A, "unstaged");

    await store.confirmDiscard();

    expect(api.discardFile).toHaveBeenCalledWith("p", "s", "a.ts", "unstaged");
    expect(store.state.pendingDiscard).toBeNull();
  });

  it("commit is a no-op when the message is blank or already committing", async () => {
    const api = fakeApi();
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });

    await store.commit();

    expect(api.commitChanges).not.toHaveBeenCalled();
  });

  it("commit clears the message and refreshes on success", async () => {
    const api = fakeApi();
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });
    store.updateCommitMessage("  fix bug  ");

    await store.commit();

    expect(api.commitChanges).toHaveBeenCalledWith("p", "s", "fix bug");
    expect(store.state.commitMessage).toBe("");
    expect(store.state.isCommitting).toBe(false);
  });

  it("commit surfaces an error and stops committing on failure", async () => {
    const api = fakeApi({ commitChanges: vi.fn().mockRejectedValue(new Error("commit failed")) });
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });
    store.updateCommitMessage("oops");

    await store.commit();

    expect(store.state.errorMessage).toBe("commit failed");
    expect(store.state.isCommitting).toBe(false);
  });

  it("openDiffFor parses a real unified diff for a tracked file", async () => {
    const api = fakeApi({
      getDiff: vi.fn().mockResolvedValue({
        diff: "@@ -1,1 +1,2 @@\n-old\n+new\n+more\n",
        isUntracked: false,
        isBinary: false,
      }),
    });
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });

    await store.openDiffFor(FILE_A, "unstaged");

    expect(store.state.openDiff?.isLoading).toBe(false);
    expect(store.state.openDiff?.parsedDiff?.additions).toBe(2);
    expect(store.state.openDiff?.parsedDiff?.deletions).toBe(1);
  });

  it("openDiffFor treats an untracked file's content as pure additions", async () => {
    const api = fakeApi({
      getDiff: vi.fn().mockResolvedValue({ diff: "line one\nline two\n", isUntracked: true, isBinary: false }),
    });
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });

    await store.openDiffFor(FILE_A, "untracked");

    expect(store.state.openDiff?.isUntracked).toBe(true);
    expect(store.state.openDiff?.parsedDiff?.additions).toBe(2);
  });

  it("openDiffFor flags binary files without attempting to parse", async () => {
    const api = fakeApi({ getDiff: vi.fn().mockResolvedValue({ diff: "", isUntracked: false, isBinary: true }) });
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });

    await store.openDiffFor(FILE_A, "unstaged");

    expect(store.state.openDiff?.isBinary).toBe(true);
    expect(store.state.openDiff?.parsedDiff).toBeNull();
  });

  it("closeDiff clears the open diff", async () => {
    const api = fakeApi({ getDiff: vi.fn().mockResolvedValue({ diff: "", isUntracked: false, isBinary: true }) });
    const store = createChangesStore({ projectId: "p", sessionSlug: "s", api });
    await store.openDiffFor(FILE_A, "unstaged");

    store.closeDiff();

    expect(store.state.openDiff).toBeNull();
  });

  it("dismissError clears the top-level error", async () => {
    const store = createChangesStore({
      projectId: "p",
      sessionSlug: "s",
      api: fakeApi({ getChanges: vi.fn().mockRejectedValue(new Error("boom")) }),
    });
    await store.refresh();

    store.dismissError();

    expect(store.state.errorMessage).toBeNull();
  });
});
