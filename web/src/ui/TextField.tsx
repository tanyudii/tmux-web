// Labeled text field -- ports kmp/.../ui/components/TmuxTextField.kt
// (itself a port of components/forms/Input.jsx). `mono` switches to the
// terminal font for paths/session names; leading icon slot, error/helper
// text, focus-glow border. Focus state is handled by CSS `:focus-within`
// (ui.css) rather than a tracked InteractionSource -- no JS needed for
// that part, unlike the Compose original.
//
// Multiline input (Compose's `singleLine = false`) is deliberately not
// ported yet -- no current screen in the plan needs a <textarea> (both
// Connect-screen fields are single-line); add it when a real caller does
// (YAGNI), following this same file's shape.
import { createUniqueId, Show } from "solid-js";
import type { JSX } from "solid-js";

export interface TextFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  mono?: boolean;
  error?: string;
  helper?: string;
  icon?: JSX.Element;
  disabled?: boolean;
  password?: boolean;
  autoCapitalize?: JSX.HTMLAutocapitalize;
  autocomplete?: string;
  class?: string;
}

export function TextField(props: TextFieldProps) {
  const id = createUniqueId();

  return (
    <div class={`tw-textfield ${props.class ?? ""}`}>
      <Show when={props.label}>
        <label class="tw-textfield__label" for={id}>
          {props.label}
        </label>
      </Show>
      <div
        class="tw-textfield__row"
        classList={{
          "tw-textfield__row--error": Boolean(props.error),
          "tw-textfield__row--mono": props.mono === true,
        }}
      >
        <Show when={props.icon}>
          <span class="tw-textfield__icon" aria-hidden="true">
            {props.icon}
          </span>
        </Show>
        <input
          id={id}
          class="tw-textfield__input"
          type={props.password ? "password" : "text"}
          value={props.value}
          placeholder={props.placeholder}
          autoCapitalize={props.autoCapitalize}
          autocomplete={props.autocomplete}
          disabled={props.disabled === true}
          onInput={(event) => props.onValueChange(event.currentTarget.value)}
        />
      </div>
      <Show when={props.error || props.helper}>
        <p
          class="tw-textfield__supporting"
          classList={{ "tw-textfield__supporting--error": Boolean(props.error) }}
        >
          {props.error ?? props.helper}
        </p>
      </Show>
    </div>
  );
}
