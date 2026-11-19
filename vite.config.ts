import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022", // top-level await
    rollupOptions: {
      // verify.html is a dev tool: replays the fixture recording to check
      // that this browser's engine reproduces it exactly.
      input: { main: "index.html", verify: "verify.html" },
    },
  },
});
