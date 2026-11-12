import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { assertSafeSupabaseTarget } from "./src/lib/supabase-build-target.ts";

export default defineConfig(({ command, mode }) => {
  assertSafeSupabaseTarget(loadEnv(mode, process.cwd(), ""), {
    command,
    mode,
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
  });

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  };
});
