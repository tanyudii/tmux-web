import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasteSheet } from "./PasteSheet";

function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  fireEvent.input(textarea, { target: { value } });
}

function field(): HTMLTextAreaElement {
  return screen.getByLabelText("Text to paste") as HTMLTextAreaElement;
}

describe("PasteSheet", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  it("renders an empty textarea when the clipboard cannot be read", () => {
    render(() => <PasteSheet onSend={vi.fn()} onDismiss={vi.fn()} />);

    expect(field().value).toBe("");
  });

  it("disables Send while the textarea is empty", () => {
    render(() => <PasteSheet onSend={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("enables Send once there is text", () => {
    render(() => <PasteSheet onSend={vi.fn()} onDismiss={vi.fn()} />);

    typeInto(field(), "npm run build");

    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("sends the typed text and dismisses", () => {
    const onSend = vi.fn();
    const onDismiss = vi.fn();
    render(() => <PasteSheet onSend={onSend} onDismiss={onDismiss} />);

    typeInto(field(), "git status");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onSend).toHaveBeenCalledExactlyOnceWith("git status");
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  // The whole reason this sheet exists: on an insecure origin (this app's
  // recommended plain-HTTP tunnel) navigator.clipboard does not exist, so
  // the ONLY way clipboard content can reach the page is the user invoking
  // iOS's own Paste command into a real editable field, which arrives as a
  // paste event carrying clipboardData.
  it("accepts text delivered by a native paste event", async () => {
    const onSend = vi.fn();
    render(() => <PasteSheet onSend={onSend} onDismiss={vi.fn()} />);

    const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: (type: string) => string };
    };
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "echo from-clipboard" },
    });
    field().dispatchEvent(event);

    await waitFor(() => expect(field().value).toBe("echo from-clipboard"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith("echo from-clipboard");
  });

  it("appends a native paste at the caret instead of replacing what is already there", async () => {
    render(() => <PasteSheet onSend={vi.fn()} onDismiss={vi.fn()} />);
    const textarea = field();
    typeInto(textarea, "sudo ");
    textarea.setSelectionRange(5, 5);

    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => "reboot" } });
    textarea.dispatchEvent(event);

    await waitFor(() => expect(textarea.value).toBe("sudo reboot"));
  });

  it("prefills from the Clipboard API when the origin is secure enough to allow reading", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockResolvedValue("prefilled command") },
      configurable: true,
    });

    render(() => <PasteSheet onSend={vi.fn()} onDismiss={vi.fn()} />);

    await waitFor(() => expect(field().value).toBe("prefilled command"));
  });

  it("stays usable when a Clipboard API read is rejected", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    render(() => <PasteSheet onSend={vi.fn()} onDismiss={vi.fn()} />);

    await waitFor(() => expect(field()).toBeInTheDocument());
    typeInto(field(), "manual");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("dismisses without sending when Cancel is pressed", () => {
    const onSend = vi.fn();
    const onDismiss = vi.fn();
    render(() => <PasteSheet onSend={onSend} onDismiss={onDismiss} />);

    typeInto(field(), "unwanted");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSend).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
