import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  build: {
    target: "es2022", // top-level await
    rollupOptions: {
      // verify.html is a dev tool: replays the fixture recording to check
      // that this browser's engine reproduces it exactly.
      input: { main: "index.html", verify: "verify.html" },
    },
  },
});
