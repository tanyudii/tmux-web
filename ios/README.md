# tmux-web iOS client

A native SwiftUI client for [tmux-web](../README.md) — same project → session →
terminal flow as the browser UI, but native on iPhone. It talks to the
**existing** tmux-web server (`../src/`) over its REST API and `/ws`
WebSocket; no server changes are required.

**This app only makes sense reachable over your VPN** (WireGuard, Tailscale,
etc.) — see the main [README's security model](../README.md#security-model--read-this-before-deploying).
Do not expose tmux-web's port to the public internet just to reach it from
this app.

## Requirements

- macOS with Xcode 16+ (this project cannot be built on Linux/Windows —
  there is no iOS toolchain outside Xcode; Xcode 16+ specifically because
  the test target uses the Swift Testing framework, `import Testing`, not
  XCTest)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`
- An iPhone (or Simulator) already able to reach your tmux-web server over
  VPN — this project has no bundled build for a "public internet" case

## Setup

```bash
cd ios
xcodegen generate
open TmuxWebClient.xcodeproj
```

Before building, edit `TmuxWebClient/Resources/Info.plist` and replace
`TMUX_WEB_VPN_HOST` under `NSAppTransptSecurity > NSExceptionDomains` with
your server's actual VPN address (e.g. `100.x.x.x` for Tailscale, or your
WireGuard interface IP). This is a narrow App Transport Security exception
scoped to that one host — see the comment in that file for why it's safe
(the VPN tunnel already encrypts the connection; tmux-web deliberately does
not add its own TLS, matching the main project's "terminate TLS at your
VPN/reverse proxy" design).

## Installing on your iPhone without TestFlight

No App Store Connect account needed -- Xcode can install straight onto a
device you own with a free Apple ID:

1. Connect the iPhone to the Mac with a cable (the first pairing must be
   wired; wireless deploys work after that).
2. In Xcode: **Settings → Accounts** -- add your Apple ID (a free account
   works, no paid Developer Program required).
3. Select the `TmuxWebClient` target → **Signing & Capabilities** → check
   **Automatically manage signing** → set Team to your Apple ID (listed as
   "*(Personal Team)*"). If bundle-ID collisions come up, change
   `PRODUCT_BUNDLE_IDENTIFIER` in `project.yml` to something unique to you.
4. Pick your iPhone as the run destination in the toolbar (not Simulator),
   then **⌘R**.
5. On the phone, the first launch shows "Untrusted Developer" -- go to
   **Settings → General → VPN & Device Management**, select your developer
   profile, and tap **Trust**.

After the initial cable pairing, you can deploy over Wi-Fi too (Xcode →
**Window → Devices and Simulators** → check "Connect via network").

**Free-account caveat:** a free Apple ID's provisioning profile expires
after **7 days** -- the app simply stops launching until you reconnect and
hit ⌘R again (no need to uninstall first). To avoid the weekly re-sign:
either pay for the Apple Developer Program ($99/yr, profiles last a year),
or use a third-party sideloading tool (AltStore, Sideloadly) that
automates the same free-account re-signing via a companion app running on
your Mac/PC.

On first launch, the app asks for:
- **Server URL** — `http://<vpn-host>:5309` (or your `TMUX_WEB_PORT`)
- **Token** — the same `TMUX_WEB_TOKEN` value the server's `.env` uses

The token is stored in the Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`),
never in `UserDefaults` or plain text.

## Running tests

```bash
cd ios
xcodegen generate
xcodebuild test -scheme TmuxWebClient -destination 'platform=iOS Simulator,name=iPhone 15'
```

## Project layout

```
TmuxWebClient/
  App/            app entry point, root navigation
  Models/         Codable types mirroring ../src/*.ts response shapes
  Networking/      APIClient (REST), TerminalSocket (WebSocket <-> SwiftTerm),
                   ClientMessage (input/resize wire protocol)
  Storage/        KeychainStore (token), ConnectionSettingsStore (host/port)
  Views/
    Settings/      first-run server URL + token entry
    Projects/       project list, new-project sheet
    Sessions/       session list per project, new-session sheet, force-delete
    Terminal/       SwiftTerm-backed terminal screen + custom keyboard bar
    Changes/        git changes/diff sidebar (parity feature, secondary)
TmuxWebClientTests/  Swift Testing: wire-protocol codec, APIClient, KeychainStore
```

## What's deliberately NOT here (yet)

- No App Store distribution — this is a personal shell client tied to your
  own server and token; see the main plan discussion for why TestFlight
  internal / device-only install is the recommended path instead.
- No environment (docker-compose) tab — the web UI's "Setup Environment"
  feature isn't ported; use the browser UI or the terminal itself for that
  for now.
- No background execution — iOS suspends the WebSocket when the app is
  backgrounded. The app reconnects (re-attaches, same as `tmux attach`)
  when it returns to the foreground; tmux itself keeps the session alive
  server-side the whole time, exactly like closing a browser tab.
