import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextField } from "./TextField";

describe("TextField", () => {
  afterEach(() => {
    cleanup();
  });

  it("associates the label with the input and reports typed input via onValueChange", () => {
    const onValueChange = vi.fn();
    render(() => <TextField label="Access token" value="" onValueChange={onValueChange} />);

    const input = screen.getByLabelText("Access token");
    fireEvent.input(input, { target: { value: "abc123" } });

    expect(onValueChange).toHaveBeenCalledWith("abc123");
  });

  it("renders the current value from a controlled signal", () => {
    const [value, setValue] = createSignal("initial");
    render(() => <TextField label="Server URL" value={value()} onValueChange={setValue} />);

    expect((screen.getByLabelText("Server URL") as HTMLInputElement).value).toBe("initial");
  });

  it("shows the error message and error styling when error is set, taking priority over helper", () => {
    render(() => (
      <TextField
        label="Token"
        value=""
        onValueChange={vi.fn()}
        error="Token is required"
        helper="Paste your access token"
      />
    ));

    expect(screen.getByText("Token is required")).toBeInTheDocument();
    expect(screen.queryByText("Paste your access token")).toBeNull();
  });

  it("shows helper text when there is no error", () => {
    render(() => <TextField label="Token" value="" onValueChange={vi.fn()} helper="Paste your access token" />);

    expect(screen.getByText("Paste your access token")).toBeInTheDocument();
  });

  it("renders a password-type input when password is set", () => {
    render(() => <TextField label="Password" value="" onValueChange={vi.fn()} password />);

    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("password");
  });

  it("renders an icon slot when given", () => {
    render(() => <TextField label="Token" value="" onValueChange={vi.fn()} icon={<span>key-icon</span>} />);

    expect(screen.getByText("key-icon")).toBeInTheDocument();
  });
});
