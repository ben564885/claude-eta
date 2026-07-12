// Learned artifacts: trains on ~/.claude/eta/history.jsonl and persists the
// result to model.json. finalize.mjs calls maybeRetrain() after each run;
// estimateInitial()/revise() call loadArtifacts() (cheap JSON read — hook
// processes are one-shot, so no caching layer is needed).

import fs from "node:fs";
import path from "node:path";
import { readHistory, etaRoot } from "./state.mjs";
import { fitPhaseMods } from "./survival.mjs";
import { fitQreg } from "./qreg.mjs";

const MODEL_FILE_NAME = "model.json";
const MIN_RUNS_TO_TRAIN = 12; // below this even phase mods are noise
const RETRAIN_EVERY = 5; // retrain once history has grown this many runs

function modelFile() {
  return path.join(etaRoot(), MODEL_FILE_NAME);
}

export function loadArtifacts() {
  try {
    return JSON.parse(fs.readFileSync(modelFile(), "utf8"));
  } catch {
    return null;
  }
}

export function trainArtifacts(rows) {
  return {
    version: 2,
    trained_at: new Date().toISOString(),
    n: rows.length,
    phase_mods: fitPhaseMods(rows),
    qreg: fitQreg(rows), // null until QREG_MIN_RUNS
  };
}

export function maybeRetrain() {
  const rows = readHistory();
  if (rows.length < MIN_RUNS_TO_TRAIN) return null;

  const existing = loadArtifacts();
  if (existing && rows.length < (existing.n ?? 0) + RETRAIN_EVERY) return existing;

  const artifacts = trainArtifacts(rows);
  const file = modelFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(artifacts));
  fs.renameSync(tmp, file);
  return artifacts;
}
