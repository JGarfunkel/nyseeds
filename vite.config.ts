import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// Auto-detect whether ordinizer was installed from the local monorepo (app/client/src/ui)
// or from GitHub (client/src/ui at package root).
const ordinizerRoot = path.resolve(import.meta.dirname, "node_modules/ordinizer");
const ordinizerClientUi = fs.existsSync(path.join(ordinizerRoot, "app/client/src/ui"))
  ? path.join(ordinizerRoot, "app/client/src/ui")
  : path.join(ordinizerRoot, "client/src/ui");

export default defineConfig({
  base: "./",
  plugins: [
    react()
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      react: path.resolve(import.meta.dirname, "node_modules/react"),
      "react-dom": path.resolve(import.meta.dirname, "node_modules/react-dom"),
      "@tanstack/react-query": path.resolve(
        import.meta.dirname,
        "node_modules/@tanstack/react-query",
      ),
      "@civillyengaged/ordinizer-client/ui": ordinizerClientUi,
      "@civillyengaged/ordinizer-app": path.resolve(import.meta.dirname, "node_modules/@civillyengaged/ordinizer-app/client/src"),
      "@civillyengaged/ordinizer-core": path.resolve(import.meta.dirname, "node_modules/@civillyengaged/ordinizer-core/src/index.ts"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
    preserveSymlinks: true,
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Disable manual chunking to avoid dependency issues
        manualChunks: undefined,
      },
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
  },
  server: {
    fs: {
      strict: false,
      allow: [
        path.resolve(import.meta.dirname),
        path.resolve(import.meta.dirname, "node_modules/ordinizer"),
        path.resolve(import.meta.dirname, "../ordinizer"),
      ],
    },
  }
});
