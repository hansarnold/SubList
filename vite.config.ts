import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const wranglerConfigPath =
  process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH ?? "./wrangler.example.jsonc";

export default defineConfig({
  plugins: [react(), cloudflare({ configPath: wranglerConfigPath })],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "localhost",
    port: 5173,
    strictPort: true,
  },
});
