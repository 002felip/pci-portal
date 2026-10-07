import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The SPA is built straight into the FastAPI static dir, so one Databricks App
// serves both tiers. `npm run dev` proxies /api to uvicorn on :8000 instead.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../backend/app/static", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
});
