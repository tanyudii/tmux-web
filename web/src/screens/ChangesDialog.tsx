// Full-screen mobile wrapper around ChangesRail.tsx -- ports kmp/.../ui/
// terminal/ChangesDialog.kt, which itself just wraps the shared
// `ChangesRail` composable in a full-screen `Dialog`. See ChangesRail.tsx
// for the actual tree/commit/diff logic, reused as-is by WebMainPane.tsx.
import { NavBar } from "../ui";
import type { ChangesStore } from "../stores/changesStore";
import { ChangesRail, DiffOverlay } from "./ChangesRail";

export interface ChangesDialogProps {
  store: ChangesStore;
  onClose: () => void;
}

export function ChangesDialog(props: ChangesDialogProps) {
  const { store } = props;
  const badgeCount = () => {
    const c = store.state.changes;
    if (!c) return 0;
    return c.staged.length + c.unstaged.length + c.untracked.length;
  };

  return (
    <div class="tw-changes-dialog">
      <NavBar title={`Changes (${badgeCount()})`} back={{ label: "Close", onClick: props.onClose }} />
      <ChangesRail store={store} />
      <DiffOverlay store={store} backLabel="Changes" />
    </div>
  );
}
