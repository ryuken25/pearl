import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Electron-specific build: relative base so all /assets/... paths become
// ./assets/... and work correctly when loaded via file:// protocol.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __BUILD_GIT_SHA__: JSON.stringify("desktop"),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: "es2022",
    sourcemap: false,
    outDir: "dist-electron",
    rollupOptions: {
      output: {
        assetFileNames: "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
  worker: {
    format: "es",
  },
});
