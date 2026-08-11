// Dismissible top-of-screen error strip for ViewModel/store-level failures
// (load failed, poll failed) that don't belong inside a specific dialog --
// ports kmp/.../ui/components/TmuxErrorBanner.kt.
import { IconButton } from "./IconButton";

export interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  class?: string;
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M1 1l10 10M11 1L1 11"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  );
}

export function ErrorBanner(props: ErrorBannerProps) {
  return (
    <div class={`tw-banner tw-error-banner ${props.class ?? ""}`} role="alert">
      <span class="tw-banner__message">{props.message}</span>
      <IconButton
        icon={<CloseIcon />}
        label="Dismiss"
        size="sm"
        onClick={props.onDismiss}
      />
    </div>
  );
}
