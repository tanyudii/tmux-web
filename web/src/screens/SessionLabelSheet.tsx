// Ports kmp/.../ui/sessions/SessionLabelSheet.kt. Single field, trimmed on
// save; an empty result clears the label (saved as null).
import { createSignal } from "solid-js";
import { Sheet, TextField } from "../ui";

export interface SessionLabelSheetProps {
  initialLabel: string | null;
  onSave: (label: string | null) => void;
  onCancel: () => void;
}

export function SessionLabelSheet(props: SessionLabelSheetProps) {
  const [label, setLabel] = createSignal(props.initialLabel ?? "");

  return (
    <Sheet
      title="Session Label"
      actionLabel="Save"
      onDismiss={props.onCancel}
      onAction={() => {
        const trimmed = label().trim();
        props.onSave(trimmed === "" ? null : trimmed);
      }}
    >
      <TextField label="Label" value={label()} onValueChange={setLabel} placeholder="backend" />
    </Sheet>
  );
}
