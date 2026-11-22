import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const target = process.env.FORGEWORKS_API_URL ?? "http://127.0.0.1:8000";
const proxy = { "/api": { target }, "/health": { target } };
export default defineConfig({
  plugins: [react(), tailwind()],
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
  test: { environment: "jsdom", include: ["tests/**/*.test.tsx"] },
});
