import { render } from "solid-js/web";
import { App } from "./App";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import { attachAppHeight } from "./viewport/appHeight";
// @xterm/xterm ships its own stylesheet and genuinely REQUIRES it -- xterm.js
// puts two working elements inside the terminal that only this stylesheet
// hides: `.xterm-helper-textarea` (the real <textarea> it reads keystrokes
// from, hidden via `opacity: 0; left: -9999em`) and
// `.xterm-char-measure-element` (a run of repeated characters it renders to
// measure glyph width, hidden via `visibility: hidden`). Without this import
// both render as visible UI -- a stray text box in the terminal's top-left
// and a line of garbage characters like "gggggg777777" above the first row.
// Imported BEFORE the app's own stylesheets so app rules still win on any
// selector conflict.
import "@xterm/xterm/css/xterm.css";
import "./styles/tokens.css";
import "./ui/ui.css";
import "./screens/screens.css";
import "./index.css";

const root = document.getElementById("app");
if (!root) {
  throw new Error("#app root element not found in index.html");
}

// Before render: the first paint should already use the real visible height
// rather than flashing a full-height layout and reflowing.
attachAppHeight();

render(() => <App />, root);
registerServiceWorker();
