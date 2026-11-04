import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Workspace packages expose their TypeScript sources under the "source"
  // condition, so the app always runs the current core (no stale dist).
  resolve: { conditions: ["source", ...defaultClientConditions] },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 6000 },
  server: { port: 5173, strictPort: true },
});
