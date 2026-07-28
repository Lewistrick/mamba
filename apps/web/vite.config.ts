import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/** Path prefix for production behind Caddy (`/mamba/`); local dev stays `/`. */
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
  resolve: {
    alias: {
      "@mamba/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
  },
});
