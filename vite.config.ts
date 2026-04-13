import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// Helper to resolve ordinizer paths - prefer local dev repo if it exists
const resolveOrdinizerPath = (subpath: string) => {
  const localPath = path.resolve(import.meta.dirname, `../ordinizer/${subpath}`);
  const nodeModulesPath = path.resolve(import.meta.dirname, `node_modules/ordinizer/${subpath}`);
  
  // Check multiple candidates (file itself, with extensions, as directory with index)
  const candidates = [
    localPath,
    `${localPath}.ts`,
    `${localPath}.tsx`,
    `${localPath}/index.ts`,
    `${localPath}/index.tsx`,
  ];
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return localPath;
    }
  }
  
  // Fall back to node_modules
  return nodeModulesPath;
};

export default defineConfig({
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
      "@ordinizer/client/ui": resolveOrdinizerPath("client/src/ui"),
      "@ordinizer/app": resolveOrdinizerPath("app/client/src"),
      "@ordinizer/core": resolveOrdinizerPath("packages/core/src/index.ts"),
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
