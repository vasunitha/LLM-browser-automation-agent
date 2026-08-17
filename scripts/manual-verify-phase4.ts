// Phase 4 manual verification: drives the real, already-running Credit
// Union Teller Console purely through the Surface abstraction (no direct
// HTTP calls, no Playwright import outside src/surface) and prints each
// step's structured result. Steps below are numbered to match the
// approved manual-verification checklist exactly. Run against a live
// instance of the app:
//
//   npm run dev                                  # terminal 1
//   npx tsx scripts/manual-verify-phase4.ts       # terminal 2
//
// Optional env overrides: TARGET_URL (default http://localhost:3000),
// MEMBER_ID (default 1001).

import { writeFileSync } from "node:fs";
import { createPlaywrightSurface } from "../src/surface";
import type { Locator } from "../src/surface";

const BASE_URL = process.env.TARGET_URL ?? "http://localhost:3000";
const MEMBER_ID = process.env.MEMBER_ID ?? "1001";
const SCREENSHOT_PATH = "./data/manual-verify-phase4-screenshot.png";

const memberIdField: Locator = {
  description: "Member ID field",
  strategies: [
    { type: "label", text: "Member ID" },
    { type: "role", role: "textbox", name: "Member ID" },
  ],
};
const searchButton: Locator = {
  description: "Search button",
  strategies: [{ type: "role", role: "button", name: "Search" }],
};
const savingsBalanceValue: Locator = {
  description: "Savings balance value",
  strategies: [{ type: "css", selector: "strong" }],
};

async function main() {
  console.log("[1/10] Start a browser session (createPlaywrightSurface)");
  const surface = await createPlaywrightSurface({ headless: true });
  console.log("       -> session started; every step below reuses this same `surface`");

  try {
    console.log(`\n[2/10] Navigate to the Credit Union Teller Console ("${BASE_URL}/")`);
    const nav = await surface.navigate(`${BASE_URL}/`);
    console.log("       ->", JSON.stringify(nav));
    if (!nav.ok) throw new Error("navigate failed — is `npm run dev` running?");

    console.log("\n[3/10] Observe the search page");
    const searchPageObs = await surface.observe();
    if (searchPageObs.ok) {
      console.log("       url:", searchPageObs.value.url);
      console.log("       title:", searchPageObs.value.title);
      console.log("       elements found:", searchPageObs.value.elements.length);
    } else {
      throw new Error(`observe() failed on search page: ${JSON.stringify(searchPageObs.error)}`);
    }

    console.log("\n[4/10] Find the member search input (via the Locator role/label fallback chain)");
    const found = searchPageObs.value.elements.find(
      (el) => el.role === "textbox" && el.name === "Member ID",
    );
    console.log(
      "       found in observation:",
      found ? JSON.stringify(found) : "NOT FOUND (type() below will fail if so)",
    );

    console.log(`\n[5/10] Enter seeded member ID "${MEMBER_ID}" into the field`);
    const typeResult = await surface.type(memberIdField, MEMBER_ID);
    console.log("       ->", JSON.stringify(typeResult));

    console.log("\n[6/10] Click Search");
    const clickResult = await surface.click(searchButton);
    console.log("       ->", JSON.stringify(clickResult));

    console.log("\n[7/10] Observe the resulting member details page");
    const detailsObs = await surface.observe();
    if (detailsObs.ok) {
      console.log("       url:", detailsObs.value.url);
      console.log(
        "       text snippet:",
        detailsObs.value.text.split("\n").filter(Boolean).slice(0, 4).join(" | "),
      );
    } else {
      console.log("       observe FAILED ->", JSON.stringify(detailsObs.error));
    }

    console.log("\n[8/10] Read the savings balance");
    const balance = await surface.read(savingsBalanceValue);
    console.log("       ->", JSON.stringify(balance));

    console.log("\n[9/10] Capture a screenshot of the current page");
    const screenshot = await surface.screenshot();
    if (screenshot.ok) {
      const buffer = Buffer.from(screenshot.value.base64, "base64");
      const isPng = buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
      writeFileSync(SCREENSHOT_PATH, buffer);
      console.log(`       -> ok, ${buffer.length} bytes, valid PNG signature: ${isPng}`);
      console.log(`       -> saved to ${SCREENSHOT_PATH} for visual inspection`);
    } else {
      console.log("       screenshot FAILED ->", JSON.stringify(screenshot.error));
    }

    console.log("\n[10/10] Sequence complete — confirm every step above used the same session");
    console.log("        -> single `surface` created once in step 1, never recreated: true");

    const reachedDetails = detailsObs.ok && detailsObs.value.url.includes(`/members/${MEMBER_ID}`);
    console.log(
      `\nVERIFICATION RESULT: ${reachedDetails && balance.ok && screenshot.ok ? "PASS" : "FAIL"}`,
      `(reached member details: ${reachedDetails}, balance read: ${balance.ok}, screenshot: ${screenshot.ok})`,
    );
  } finally {
    await surface.close();
  }
}

main().catch((err) => {
  console.error("Manual verification script failed:", err);
  process.exitCode = 1;
});
