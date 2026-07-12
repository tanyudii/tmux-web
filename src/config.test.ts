import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseConfig, ConfigError } from "./config.ts";

const VALID_ENV = {
  TMUX_WEB_TOKEN: "a-secret-token-that-is-long-enough",
  TMUX_WEB_PORT: "5309",
  TMUX_WEB_BIND_HOST: "10.0.0.1",
  TMUX_WEB_DATA_DIR: "/data/tmux-web",
};

test("parseConfig returns the parsed values for a fully-specified env", () => {
  assert.deepEqual(parseConfig(VALID_ENV), {
    token: "a-secret-token-that-is-long-enough",
    port: 5309,
    bindHost: "10.0.0.1",
    dataDir: "/data/tmux-web",
  });
});

test("parseConfig defaults TMUX_WEB_DATA_DIR to ~/.tmux-web when unset", () => {
  const { TMUX_WEB_DATA_DIR, ...rest } = VALID_ENV;
  assert.equal(parseConfig(rest).dataDir, join(homedir(), ".tmux-web"));
});

test("parseConfig throws when TMUX_WEB_TOKEN is missing", () => {
  const { TMUX_WEB_TOKEN, ...rest } = VALID_ENV;
  assert.throws(() => parseConfig(rest), ConfigError);
});

test("parseConfig throws when TMUX_WEB_TOKEN is too short", () => {
  assert.throws(() => parseConfig({ ...VALID_ENV, TMUX_WEB_TOKEN: "short" }), ConfigError);
});

test("parseConfig throws when TMUX_WEB_PORT is not a number", () => {
  assert.throws(() => parseConfig({ ...VALID_ENV, TMUX_WEB_PORT: "not-a-port" }), ConfigError);
});

test("parseConfig throws when TMUX_WEB_PORT is out of range", () => {
  assert.throws(() => parseConfig({ ...VALID_ENV, TMUX_WEB_PORT: "0" }), ConfigError);
  assert.throws(() => parseConfig({ ...VALID_ENV, TMUX_WEB_PORT: "70000" }), ConfigError);
});

test("parseConfig defaults TMUX_WEB_PORT to 5309 when unset", () => {
  const { TMUX_WEB_PORT, ...rest } = VALID_ENV;
  assert.equal(parseConfig(rest).port, 5309);
});

test("parseConfig defaults TMUX_WEB_BIND_HOST to 127.0.0.1 when unset", () => {
  const { TMUX_WEB_BIND_HOST, ...rest } = VALID_ENV;
  assert.equal(parseConfig(rest).bindHost, "127.0.0.1");
});
