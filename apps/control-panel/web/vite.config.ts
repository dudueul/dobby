import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxies /api to the BFF; prod is served by the BFF as static files.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8088", changeOrigin: true, ws: true },
    },
  },
});
