// Refreshes public/vendor/ from xterm.js's built output so the server can
// serve it as a plain static file, no bundler required. Runs on
// `npm install` (see package.json "postinstall") to pick up whatever
// @xterm/* version package.json currently declares.
//
// public/vendor/ is committed to git (not generated-and-gitignored) so a
// tagged checkout already has correct vendor files without depending on
// this script running -- cheap defense-in-depth against `npm ci
// --ignore-scripts` or an install that's interrupted before postinstall
// runs. This script still degrades gracefully (warns and exits 0) instead
// of failing the whole `npm install`/`npm ci` if node_modules isn't fully
// populated yet when it runs.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(rootDir, "public", "vendor");

const files = [
  ["node_modules/@xterm/xterm/lib/xterm.js", "xterm.js"],
  ["node_modules/@xterm/xterm/css/xterm.css", "xterm.css"],
  ["node_modules/@xterm/addon-fit/lib/addon-fit.js", "addon-fit.js"],
];

const missing = files.filter(([src]) => !existsSync(join(rootDir, src)));
if (missing.length > 0) {
  console.warn(
    `Skipping vendor refresh: node_modules isn't fully installed yet (missing ${missing.length} source file(s)). ` +
      "public/vendor/ is committed to git, so this is only a problem if you're bumping the @xterm/* version -- " +
      "in that case, run `npm install` again once node_modules is populated.",
  );
  process.exit(0);
}

mkdirSync(vendorDir, { recursive: true });

for (const [src, destName] of files) {
  copyFileSync(join(rootDir, src), join(vendorDir, destName));
}

console.log(`Copied ${files.length} vendor files to public/vendor/`);
