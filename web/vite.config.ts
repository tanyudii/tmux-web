/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Custom asset filenames: pure lowercase-hex hashes with no name prefix, so
// they match src/server.ts's existing CONTENT_HASHED_FILENAME regex
// (`/^[0-9a-f]{16,}\.[^.]+$/i`) unchanged. That regex is what grants
// `immutable, max-age=31536000` caching to fingerprinted build output; a
// mismatch here would silently downgrade every JS/CSS asset to `no-cache`
// without breaking anything visibly. See CI verification: `npm run build`
// then inspect `dist/assets/*` filenames against the regex before touching
// server.ts.
const HASHED_ASSET_PATTERN = "assets/[hash:16].[ext]";

export default defineConfig({
  plugins: [solid()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5309",
      "/internal": "http://127.0.0.1:5309",
      "/ws": { target: "ws://127.0.0.1:5309", ws: true },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // hashCharacters: "hex" is required -- Rollup/Rolldown's default hash
        // alphabet is base64-like (mixed case, includes chars outside a-f),
        // which fails server.ts's CONTENT_HASHED_FILENAME regex and silently
        // downgrades every asset to `no-cache`. Verified empirically by
        // inspecting `dist/assets/*` after a real build, not assumed from docs.
        hashCharacters: "hex",
        entryFileNames: "assets/[hash:16].js",
        chunkFileNames: "assets/[hash:16].js",
        assetFileNames: HASHED_ASSET_PATTERN,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
