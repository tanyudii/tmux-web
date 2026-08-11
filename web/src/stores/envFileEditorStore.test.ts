import { describe, expect, it, vi } from "vitest";
import { createEnvFileEditorStore } from "./envFileEditorStore";

const FILES = [{ filename: "docker-compose.yml" }, { filename: "pre-run.sh" }];

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    listEnvFiles: vi.fn().mockResolvedValue(FILES),
    readEnvFile: vi.fn().mockResolvedValue("content-a"),
    writeEnvFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createEnvFileEditorStore", () => {
  it("start() loads the file list, auto-selects the first file, and loads its content", async () => {
    const api = fakeApi();
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });

    await store.start();

    expect(api.listEnvFiles).toHaveBeenCalledWith("p", "s");
    expect(api.readEnvFile).toHaveBeenCalledWith("p", "s", "docker-compose.yml");
    expect(store.state.files).toEqual(FILES);
    expect(store.state.selectedFilename).toBe("docker-compose.yml");
    expect(store.state.draftContent).toBe("content-a");
    expect(store.state.isLoading).toBe(false);
  });

  it("start() with an empty file list leaves selectedFilename null and never calls readEnvFile", async () => {
    const api = fakeApi({ listEnvFiles: vi.fn().mockResolvedValue([]) });
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });

    await store.start();

    expect(store.state.files).toEqual([]);
    expect(store.state.selectedFilename).toBeNull();
    expect(store.state.isLoading).toBe(false);
    expect(api.readEnvFile).not.toHaveBeenCalled();
  });

  it("start() sets errorMessage on a failed file-list load", async () => {
    const api = fakeApi({ listEnvFiles: vi.fn().mockRejectedValue(new Error("boom")) });
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });

    await store.start();

    expect(store.state.errorMessage).toBe("boom");
    expect(store.state.isLoading).toBe(false);
  });

  it("selectFile(filename) loads that file's content", async () => {
    const api = fakeApi();
    api.readEnvFile.mockResolvedValueOnce("content-a").mockResolvedValueOnce("content-b");
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });
    await store.start();

    await store.selectFile("pre-run.sh");

    expect(api.readEnvFile).toHaveBeenLastCalledWith("p", "s", "pre-run.sh");
    expect(store.state.selectedFilename).toBe("pre-run.sh");
    expect(store.state.draftContent).toBe("content-b");
  });

  it("updateDraft(content) sets draftContent without hitting the network", async () => {
    const api = fakeApi();
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });
    await store.start();

    store.updateDraft("edited content");

    expect(store.state.draftContent).toBe("edited content");
    expect(api.writeEnvFile).not.toHaveBeenCalled();
  });

  it("save() writes the current draft and updates savedFilename on success", async () => {
    const api = fakeApi();
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });
    await store.start();
    store.updateDraft("edited content");

    await store.save();

    expect(api.writeEnvFile).toHaveBeenCalledWith("p", "s", "docker-compose.yml", "edited content");
    expect(store.state.savedFilename).toBe("docker-compose.yml");
    expect(store.state.isSaving).toBe(false);
    expect(store.state.errorMessage).toBeNull();
  });

  it("save() is a no-op when there is no selected file", async () => {
    const api = fakeApi({ listEnvFiles: vi.fn().mockResolvedValue([]) });
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });
    await store.start();

    await store.save();

    expect(api.writeEnvFile).not.toHaveBeenCalled();
  });

  it("save() sets errorMessage and clears isSaving on failure, without clearing savedFilename from a prior save", async () => {
    const api = fakeApi();
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });
    await store.start();
    await store.save();
    expect(store.state.savedFilename).toBe("docker-compose.yml");

    api.writeEnvFile.mockRejectedValueOnce(new Error("disk full"));
    store.updateDraft("more edits");
    await store.save();

    expect(store.state.errorMessage).toBe("disk full");
    expect(store.state.isSaving).toBe(false);
  });

  it("selecting a different file clears errorMessage and savedFilename from a previous file", async () => {
    const api = fakeApi();
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });
    await store.start();
    await store.save();
    expect(store.state.savedFilename).toBe("docker-compose.yml");

    await store.selectFile("pre-run.sh");

    expect(store.state.savedFilename).toBeNull();
    expect(store.state.errorMessage).toBeNull();
  });

  it("dismissError clears errorMessage", async () => {
    const api = fakeApi({ listEnvFiles: vi.fn().mockRejectedValue(new Error("boom")) });
    const store = createEnvFileEditorStore({ projectId: "p", sessionSlug: "s", api });
    await store.start();

    store.dismissError();

    expect(store.state.errorMessage).toBeNull();
  });
});
