// Run by wrangler before it deploys or serves (wrangler.jsonc "build"). On
// Cloudflare's Git builds (WORKERS_CI is set), build the game into dist/ so the
// Worker serves it; locally, `npm run deploy` / `npm run serve` build already,
// and `npm run relay` doesn't need to.
import { execSync } from "node:child_process";
if (process.env.WORKERS_CI) execSync("npm run build", { stdio: "inherit" });
