// Mobile paste entry point. This is a sheet with a real <textarea> rather
// than a one-tap "Paste" button because on this app's recommended
// deployment there is no way for a button to read the clipboard at all:
// plain HTTP on a non-localhost host is an insecure origin, where
// navigator.clipboard does not exist, the browser's context menu omits
// Paste, and document.execCommand("paste") is blocked outright (all three
// confirmed live -- see CLAUDE.md's "Clipboard paste into Web text fields
// is impossible on insecure origins").
//
// What DOES still work everywhere is the user invoking their own platform's
// Paste command into a focused editable field: iOS delivers that as a
// `paste` event carrying clipboardData, which needs no permission and no
// secure context. So the sheet gives the user something to paste *into*,
// and forwards the result on Send.
//
// The Clipboard API is still attempted on mount, purely so that a secure
// deployment (HTTPS, or localhost during development) gets the field
// prefilled and the flow collapses to open-and-tap-Send. It is a
// convenience layered on top of the manual path, never a replacement for
// it -- there is exactly one UI here, so the path that must work on the
// user's actual deployment is also the path exercised in development.
import { createSignal, onMount } from "solid-js";
import { Sheet } from "../ui";

export interface PasteSheetProps {
  onSend: (text: string) => void;
  onDismiss: () => void;
  // Injectable for tests; defaults to the real (possibly absent) Clipboard API.
  readClipboard?: () => Promise<string>;
}

export function PasteSheet(props: PasteSheetProps) {
  const [text, setText] = createSignal("");
  let textarea!: HTMLTextAreaElement;

  onMount(() => {
    // Autofocus so the user's very next action can be the long-press that
    // brings up iOS's own Paste callout, with no intermediate tap.
    textarea.focus();

    const read = props.readClipboard ?? defaultReadClipboard;
    void read()
      .then((clipboardText) => {
        // Never clobber something the user has already pasted or typed by
        // hand: the async read can land after they beat us to it.
        if (clipboardText !== "" && text() === "") setText(clipboardText);
      })
      .catch(() => {
        // Expected on every insecure origin, and on secure ones where the
        // user declines the permission prompt. The manual path below is the
        // real one; this is only ever a shortcut.
      });
  });

  // Solid does not re-render on native input mutations, so the value shown
  // and the value sent both come from the signal -- meaning a native paste
  // has to be folded in explicitly rather than left to the DOM. Doing it by
  // hand also lets the paste land at the caret instead of replacing
  // everything, which matters when the user is assembling a command around
  // the pasted fragment.
  const handlePaste = (event: ClipboardEvent): void => {
    const pasted = event.clipboardData?.getData("text") ?? "";
    if (pasted === "") return;
    event.preventDefault();
    const current = text();
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    setText(current.slice(0, start) + pasted + current.slice(end));
  };

  return (
    <Sheet
      title="Paste"
      actionLabel="Send"
      actionEnabled={text() !== ""}
      onDismiss={props.onDismiss}
      onAction={() => {
        props.onSend(text());
        props.onDismiss();
      }}
    >
      <label class="tw-paste-sheet__label" for="tw-paste-input">
        Text to paste
      </label>
      <textarea
        id="tw-paste-input"
        ref={textarea}
        class="tw-paste-sheet__input"
        value={text()}
        rows={4}
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        placeholder="Press and hold here, then tap Paste"
        onInput={(event) => setText(event.currentTarget.value)}
        onPaste={handlePaste}
      />
      <p class="tw-paste-sheet__hint">Sent to the terminal exactly as written — check it before tapping Send.</p>
    </Sheet>
  );
}

function defaultReadClipboard(): Promise<string> {
  // Optional-chained rather than feature-tested against window: on an
  // insecure origin `navigator.clipboard` is undefined outright, which this
  // turns into a rejected promise and therefore the manual path.
  const readText = navigator.clipboard?.readText;
  if (!readText) return Promise.reject(new Error("Clipboard API unavailable"));
  return navigator.clipboard.readText();
}
