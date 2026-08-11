import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewSessionSheet } from "./NewSessionSheet";

const TEMPLATE_A = { id: "t1", projectId: "proj", name: "dev", startupCommand: "npm run dev", createdAt: "2026-01-01T00:00:00Z" };
const TEMPLATE_B = { id: "t2", projectId: "proj", name: "test", startupCommand: undefined, createdAt: "2026-01-01T00:00:00Z" };

function renderSheet(overrides: Record<string, unknown> = {}) {
  const onCreate = vi.fn();
  const onSaveAsTemplate = vi.fn();
  const onDeleteTemplate = vi.fn();
  const onCancel = vi.fn();
  render(() => (
    <NewSessionSheet
      creationState={null}
      templates={[]}
      onCreate={onCreate}
      onSaveAsTemplate={onSaveAsTemplate}
      onDeleteTemplate={onDeleteTemplate}
      onCancel={onCancel}
      {...overrides}
    />
  ));
  return { onCreate, onSaveAsTemplate, onDeleteTemplate, onCancel };
}

describe("NewSessionSheet", () => {
  afterEach(() => {
    cleanup();
  });

  it("disables Create until a name is typed, then calls onCreate with the trimmed name and no startup command", () => {
    const { onCreate } = renderSheet();

    expect((screen.getByText("Create") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "  build  " } });
    fireEvent.click(screen.getByText("Create"));

    expect(onCreate).toHaveBeenCalledWith("build", undefined);
  });

  it("passes a trimmed startup command through to onCreate when filled in", () => {
    const { onCreate } = renderSheet();

    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "build" } });
    fireEvent.input(screen.getByLabelText("Startup command (optional)"), { target: { value: "  npm run dev  " } });
    fireEvent.click(screen.getByText("Create"));

    expect(onCreate).toHaveBeenCalledWith("build", "npm run dev");
  });

  it("shows the progress bar with the server's progress message while saving", () => {
    renderSheet({ creationState: { isSaving: true, progressMessage: "Cloning repo…", errorMessage: null } });

    expect(screen.getByText("Cloning repo…")).toBeInTheDocument();
    expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(true);
  });

  it("shows the creation error message when present", () => {
    renderSheet({ creationState: { isSaving: false, progressMessage: null, errorMessage: "clone failed" } });

    expect(screen.getByText("clone failed")).toBeInTheDocument();
  });

  it("'Save as template' is disabled until a name is typed, then calls onSaveAsTemplate", () => {
    const { onSaveAsTemplate } = renderSheet();

    expect((screen.getByRole("button", { name: "Save as template" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.input(screen.getByLabelText("Name"), { target: { value: "build" } });
    fireEvent.input(screen.getByLabelText("Startup command (optional)"), { target: { value: "npm run build" } });
    fireEvent.click(screen.getByText("Save as template"));

    expect(onSaveAsTemplate).toHaveBeenCalledWith("build", "npm run build");
  });

  it("no Templates section is shown when there are no templates", () => {
    renderSheet();

    expect(screen.queryByText("Templates")).toBeNull();
  });

  it("shows templates, applies name+startupCommand on click, and shows no startup command line when absent", () => {
    renderSheet({ templates: [TEMPLATE_A, TEMPLATE_B] });

    expect(screen.getByText("Templates")).toBeInTheDocument();
    expect(screen.getByText("dev")).toBeInTheDocument();
    expect(screen.getByText("npm run dev")).toBeInTheDocument();
    expect(screen.getByText("test")).toBeInTheDocument();

    fireEvent.click(screen.getByText("dev"));

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("dev");
    expect((screen.getByLabelText("Startup command (optional)") as HTMLInputElement).value).toBe("npm run dev");
  });

  it("applying a template with no startup command clears the field", () => {
    renderSheet({ templates: [TEMPLATE_A, TEMPLATE_B] });

    fireEvent.click(screen.getByText("dev"));
    fireEvent.click(screen.getByText("test"));

    expect((screen.getByLabelText("Startup command (optional)") as HTMLInputElement).value).toBe("");
  });

  it("deleting a template calls onDeleteTemplate without applying it", () => {
    const { onDeleteTemplate } = renderSheet({ templates: [TEMPLATE_A] });

    fireEvent.click(screen.getByRole("button", { name: "Delete template dev" }));

    expect(onDeleteTemplate).toHaveBeenCalledWith("t1");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });
});
