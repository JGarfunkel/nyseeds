import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Helper to resolve ordinizer paths - use node_modules path directly
const resolveOrdinizerPath = (subpath: string) => {
  // Use the node_modules path directly since git dependency should be installed there
  return `ordinizer/${subpath}`;
};

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
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
      "@ordinizer/core": resolveOrdinizerPath("packages/core/src"),
      "@ordinizer/client/ui": resolveOrdinizerPath("client/src/ui/index.ts"),
      "@ordinizer/app": resolveOrdinizerPath("app/client/src"),
      "@ordinizer/client": resolveOrdinizerPath("client/src/index.ts"),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-query"],
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
      strict: true,
      deny: ["**/.*"],
    },
  },
});
