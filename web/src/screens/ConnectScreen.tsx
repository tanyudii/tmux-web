// Connect screen -- ports kmp/.../ui/settings/SettingsScreen.kt (itself a
// port of ui_kits/ios/app.jsx's `ConnectScreen`). Rendered whenever
// connectionSettingsStore's `current` is null (see App.tsx).
import { Group, NavBar, TextField, Button } from "../ui";
import type { ConnectionSettingsStore } from "../stores/connectionSettingsStore";

export interface ConnectScreenProps {
  store: ConnectionSettingsStore;
}

function ServerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="4" rx="1" stroke="currentColor" stroke-width="1.3" />
      <rect x="2" y="9.5" width="12" height="4" rx="1" stroke="currentColor" stroke-width="1.3" />
      <circle cx="4.5" cy="4.5" r="0.75" fill="currentColor" />
      <circle cx="4.5" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M7.5 10.5l3-3M7 6.2l.6-.6a2.6 2.6 0 013.7 3.7l-.6.6M11 11.8l-.6.6a2.6 2.6 0 01-3.7-3.7l.6-.6"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// error takes visual priority over helper (see TextField), so the
// paste-restricted hint only surfaces once there's no real error to show.
function pasteRestrictedHelper(store: ConnectionSettingsStore): string | undefined {
  if (store.state.errorMessage === null && store.pasteRestricted()) {
    return "Clipboard paste isn't available on this connection (needs HTTPS or localhost) — type the token instead.";
  }
  return undefined;
}

export function ConnectScreen(props: ConnectScreenProps) {
  const { store } = props;

  return (
    <div class="tw-screen">
      <NavBar title="Connect" large />
      <div class="tw-connect-screen__body">
        <div class="tw-connect-screen__wordmark">
          <div class="tw-connect-screen__badge">
            <ServerIcon />
          </div>
          <span class="tw-connect-screen__wordmark-text">tmux-web</span>
        </div>
        <Group
          header="Server"
          footer="Point at your tmux-web backend. Connection is stored securely on-device."
        >
          <div class="tw-connect-screen__form">
            <TextField
              label="Server URL"
              value={store.state.serverUrlText}
              onValueChange={store.updateServerUrlText}
              mono
              icon={<ServerIcon />}
              disabled={store.state.isTesting}
            />
            <TextField
              label="Access token"
              value={store.state.token}
              onValueChange={store.updateToken}
              mono
              password
              placeholder="ghp_…"
              error={store.state.errorMessage ?? undefined}
              helper={pasteRestrictedHelper(store)}
              disabled={store.state.isTesting}
            />
          </div>
        </Group>
      </div>
      {/* Deliberately a sibling of __body, not a child of it. __body is a
          flex-1 scroller, so anything inside it can end up below the fold on a
          short viewport -- and on a login screen the submit button is the one
          control that must never require scrolling to find. Keeping it pinned
          as the screen's last flex row means it is always visible regardless of
          viewport height, and it is what carries the bottom safe-area inset for
          this screen. */}
      <div class="tw-connect-screen__submit">
        <Button
          label={store.state.isTesting ? "Connecting…" : "Connect"}
          size="lg"
          icon={store.state.isTesting ? undefined : <LinkIcon />}
          loading={store.state.isTesting}
          disabled={!store.canSubmit()}
          fillWidth
          onClick={() => void store.testAndSave()}
        />
      </div>
    </div>
  );
}
