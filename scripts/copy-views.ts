import { cpSync } from "node:fs";
import { join } from "node:path";

// tsc only compiles .ts files, so EJS templates never make it into dist/
// on their own. This copies them into place after the TypeScript build so
// `npm start` (running dist/index.js) can find dist/app/views/*.ejs the
// same way `npm run dev` finds src/app/views/*.ejs directly.
const src = join(__dirname, "..", "src", "app", "views");
const dest = join(__dirname, "..", "dist", "app", "views");

cpSync(src, dest, { recursive: true });
console.log(`Copied views: ${src} -> ${dest}`);
