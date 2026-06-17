import { defineConfig } from "vite";

// Tauri expects a fixed port and dev server on 1420.
export default defineConfig({
  root: "src",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "esnext",
  },
  test: {
    environment: "jsdom",
    include: ["../src/**/*.test.js"],
  },
});
