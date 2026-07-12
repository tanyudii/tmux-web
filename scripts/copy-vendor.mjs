// Copies xterm.js's built output into public/vendor/ so the server can
// serve it as a plain static file, no bundler required. Runs on
// `npm install` (see package.json "postinstall").
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(rootDir, "public", "vendor");

const files = [
  ["node_modules/@xterm/xterm/lib/xterm.js", "xterm.js"],
  ["node_modules/@xterm/xterm/css/xterm.css", "xterm.css"],
  ["node_modules/@xterm/addon-fit/lib/addon-fit.js", "addon-fit.js"],
];

mkdirSync(vendorDir, { recursive: true });

for (const [src, destName] of files) {
  copyFileSync(join(rootDir, src), join(vendorDir, destName));
}

console.log(`Copied ${files.length} vendor files to public/vendor/`);
