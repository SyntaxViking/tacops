import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // Epoch ms at build time (or dev-server start) - a rough version proxy shown in the corner of
  // the page (see BuildTimestamp.tsx). Declared in src/vite-env.d.ts.
  define: {
    __BUILD_TIME__: Date.now(),
  },

  build: {
    rollupOptions: {
      // Multi-page build: the main app plus standalone reference pages under library/ (e.g.
      // library/reanimator-incursion-mythic-2) that aren't part of the app's own tabs/nav - each
      // is its own static page riding along on this same Worker + [assets] deploy (see
      // wrangler.toml), at /library/<name>/ once built. Add a new entry here for each new
      // library/<name>/index.html.
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        "library/reanimator-incursion-mythic-2": fileURLToPath(
          new URL("./library/reanimator-incursion-mythic-2/index.html", import.meta.url),
        ),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
