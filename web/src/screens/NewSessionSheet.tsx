// Ports kmp/.../ui/sessions/NewSessionSheet.kt + the desktop-only
// NewSessionDialog/TemplatePicker/TemplateRow composables folded into
// WebShellScreen.kt (folded into this one shared file here, same
// reasoning as NewProjectSheet.tsx: web/ already unifies the mobile sheet
// and desktop dialog into a single component). `name` is required (mono
// field, terminal icon); `startupCommand` is optional (EMB-220, task
// #18b -- previously unported entirely). While `creationState.isSaving`
// the sheet shows an indeterminate progress bar (or the server's own
// progress message) in place of letting the user resubmit.
import { createSignal, For, Show } from "solid-js";
import { IconButton, ListRow, ProgressBar, Sheet, TextField, Button } from "../ui";
import type { SessionCreationState } from "../stores/sessionListStore";
import type { SessionTemplate } from "../api/types";

export interface NewSessionSheetProps {
  creationState: SessionCreationState | null;
  templates: SessionTemplate[];
  onCreate: (name: string, startupCommand?: string) => void;
  onSaveAsTemplate: (name: string, startupCommand?: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onCancel: () => void;
}

function TerminalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2" />
      <path d="M4 6l2.5 2-2.5 2M8 10h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 4.5h9M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5M5 4.5v8a1 1 0 001 1h4a1 1 0 001-1v-8"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// EMB-220: saved per-project session templates, offered as one-click
// fill-ins for name + startup command. Only rendered when there's at
// least one, matching the Kotlin original's `if (templates.isNotEmpty())`.
function TemplatePicker(props: {
  templates: SessionTemplate[];
  disabled: boolean;
  onApply: (template: SessionTemplate) => void;
  onDelete: (templateId: string) => void;
}) {
  return (
    <div class="tw-template-picker">
      <span class="tw-template-picker__label">Templates</span>
      <div class="tw-template-picker__list">
        <For each={props.templates}>
          {(template) => (
            <ListRow
              title={template.name}
              subtitle={template.startupCommand}
              chevron={false}
              onClick={() => !props.disabled && props.onApply(template)}
              trailing={
                <span onClick={(event) => event.stopPropagation()}>
                  <IconButton
                    icon={<TrashIcon />}
                    label={`Delete template ${template.name}`}
                    variant="danger"
                    size="sm"
                    disabled={props.disabled}
                    onClick={() => props.onDelete(template.id)}
                  />
                </span>
              }
            />
          )}
        </For>
      </div>
    </div>
  );
}

export function NewSessionSheet(props: NewSessionSheetProps) {
  const [name, setName] = createSignal("");
  const [startupCommand, setStartupCommand] = createSignal("");
  const isSaving = () => props.creationState?.isSaving === true;
  const trimmedStartupCommand = () => (startupCommand().trim() === "" ? undefined : startupCommand().trim());

  function applyTemplate(template: SessionTemplate): void {
    setName(template.name);
    setStartupCommand(template.startupCommand ?? "");
  }

  return (
    <Sheet
      title="New Session"
      actionLabel="Create"
      actionEnabled={name().trim() !== "" && !isSaving()}
      onDismiss={props.onCancel}
      onAction={() => props.onCreate(name().trim(), trimmedStartupCommand())}
    >
      <Show when={props.templates.length > 0}>
        <TemplatePicker
          templates={props.templates}
          disabled={isSaving()}
          onApply={applyTemplate}
          onDelete={props.onDeleteTemplate}
        />
      </Show>
      <TextField
        label="Name"
        value={name()}
        onValueChange={setName}
        placeholder="build"
        mono
        icon={<TerminalIcon />}
        disabled={isSaving()}
      />
      <TextField
        label="Startup command (optional)"
        value={startupCommand()}
        onValueChange={setStartupCommand}
        placeholder="npm run dev"
        mono
        disabled={isSaving()}
      />
      <Button
        label="Save as template"
        variant="secondary"
        size="sm"
        disabled={isSaving() || name().trim() === ""}
        onClick={() => props.onSaveAsTemplate(name().trim(), trimmedStartupCommand())}
      />
      <Show when={isSaving()}>
        <ProgressBar label={props.creationState?.progressMessage ?? "Creating…"} />
      </Show>
      <Show when={props.creationState?.errorMessage}>
        <p class="tw-sheet__error">{props.creationState?.errorMessage}</p>
      </Show>
    </Sheet>
  );
}
