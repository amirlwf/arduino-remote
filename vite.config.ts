import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config — web build for both the browser QA pass and the Capacitor shell.
export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true, host: "127.0.0.1" },
});
