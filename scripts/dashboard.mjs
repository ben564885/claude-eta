#!/usr/bin/env node
// Generates a self-contained local HTML report of what claude-eta has
// learned (calibration, trained model, backtest) and opens it in the
// default browser. Read-only, no network calls — everything comes from
// ~/.claude/eta/ and the file never leaves disk. Invoked via /eta-dashboard
// or directly.

import path from "node:path";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { etaRoot } from "../lib/state.mjs";
import { buildReport } from "../lib/report.mjs";
import { renderDashboardHTML } from "../lib/dashboard-html.mjs";

const report = buildReport();
const html = renderDashboardHTML(report);

const outFile = path.join(etaRoot(), "dashboard.html");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);

console.log(`Wrote ${outFile}`);

if (process.argv.includes("--no-open") || process.env.CLAUDE_ETA_NO_OPEN) {
  process.exit(0);
}

const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
try {
  const child = spawn(opener, [outFile], { detached: true, stdio: "ignore", shell: process.platform === "win32" });
  child.unref();
} catch {
  console.log(`Open it manually: ${outFile}`);
}
