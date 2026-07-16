package com.tanyudii.tmuxweb.domain

/**
 * True unless the app is running as a Web page served over a non-secure
 * origin (plain HTTP on anything other than localhost/127.0.0.1) -- e.g.
 * this project's own recommended WireGuard/Tailscale-tunnel deployment
 * (see XtermJs.kt's copyTextToClipboard comment). Live-verified via
 * headless Chromium: on such an origin `navigator.clipboard` does not
 * exist at all, Compose's own right-click "Paste" menu item is omitted
 * (only "Select all" remains), and the legacy `document.execCommand("paste")`
 * fallback is blocked by the browser -- there is no JS-level workaround,
 * so the UI surfaces this instead of leaving Ctrl+V looking silently
 * broken. Non-Web platforms have no such restriction, so they report true.
 */
expect fun isSecureContext(): Boolean
