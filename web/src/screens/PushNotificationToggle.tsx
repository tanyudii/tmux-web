// Ports ui/components/PushNotificationToggle.kt -- "Enable push
// notifications" bell toggle. Renders nothing when the platform can't do
// browser push at all (a Web browser without Notification/PushManager
// support) -- there's nothing a disabled bell icon would communicate that's
// worth the visual clutter, same rationale as the Kotlin original.
//
// Takes a PushStore as a prop rather than constructing its own (unlike the
// Kotlin original's `remember { PushNotificationViewModel(...) }`) because
// this port's store must be created once for the whole connected app, not
// once per toolbar mount -- see pushStore.ts's header comment and
// App.tsx's single `createPushStore` call.
import type { PushStore } from "../stores/pushStore";
import { IconButton } from "../ui";

export interface PushNotificationToggleProps {
  store: PushStore;
}

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5c-1.8 0-3.2 1.4-3.2 3.2v1.8c0 .5-.2 1-.6 1.4L3 10.2c-.3.3-.1.8.3.8h9.4c.4 0 .6-.5.3-.8l-1.2-1.3c-.4-.4-.6-.9-.6-1.4V5.7c0-1.8-1.4-3.2-3.2-3.2z"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
      <path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  );
}

function BellOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5c-1.8 0-3.2 1.4-3.2 3.2v1.8c0 .5-.2 1-.6 1.4L3 10.2c-.3.3-.1.8.3.8h9.4c.4 0 .6-.5.3-.8l-1.2-1.3c-.4-.4-.6-.9-.6-1.4V5.7c0-1.8-1.4-3.2-3.2-3.2z"
        stroke="currentColor"
        stroke-width="1.2"
        stroke-linejoin="round"
      />
      <path d="M6.5 12.5a1.5 1.5 0 003 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      <path d="M2.5 2.5l11 11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
    </svg>
  );
}

export function PushNotificationToggle(props: PushNotificationToggleProps) {
  if (!props.store.state.isSupported) return null;

  return (
    <IconButton
      icon={props.store.state.isEnabled ? <BellIcon /> : <BellOffIcon />}
      label={props.store.state.isEnabled ? "Disable push notifications" : "Enable push notifications"}
      onClick={() => props.store.toggle()}
      variant={props.store.state.isEnabled ? "filled" : "ghost"}
      disabled={props.store.state.isBusy}
    />
  );
}
