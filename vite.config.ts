import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const libraryEntry = new URL("./src/index.ts", import.meta.url).pathname;
const clientDirectiveBanner = '"use client";';

export default defineConfig(({ command, mode }) => {
  const isDemoBuild = command === "build" && mode === "demo";

  if (isDemoBuild) {
    return {
      plugins: [react()],
      build: {
        outDir: "demo-dist",
        sourcemap: false,
      },
    };
  }

  if (command === "serve") {
    return {
      plugins: [react()],
      server: {
        port: 5173,
      },
    };
  }

  return {
    plugins: [react()],
    build: {
      lib: {
        entry: libraryEntry,
        name: "DepthChart",
        formats: ["es", "cjs"],
        fileName: (format) => (format === "es" ? "index.esm.js" : "index.js"),
      },
      rollupOptions: {
        external: ["react", "react-dom", "react/jsx-runtime"],
        output: {
          banner: clientDirectiveBanner,
        },
      },
      sourcemap: false,
    },
  };
});