// Repo-shape scan, run once per session (cached — see lib/state.mjs) rather
// than on every submit. Only *derived* numbers are ever persisted: no repo
// path, no remote URL, no file contents. `repo_id` is a hash so cross-repo
// grouping (research analysis) is possible without the log naming the repo.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const GIT_TIMEOUT_MS = 3000;
const FALLBACK_FIND_TIMEOUT_MS = 3000;
const FALLBACK_EXCLUDES = ["node_modules", ".git", "dist", "build", ".next", "vendor"];

const LANGUAGE_BY_EXT = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  rb: "Ruby",
  php: "PHP",
  c: "C",
  h: "C",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  cs: "C#",
  swift: "Swift",
  m: "Objective-C",
  mm: "Objective-C",
  scala: "Scala",
  sh: "Shell",
  sql: "SQL",
};

const RE_TEST_PATH = /(^|\/)(__tests__|tests?)\/|[._-](test|spec)\.[^/]+$/i;
const RE_TEST_CONFIG = /(^|\/)(jest\.config|vitest\.config|pytest\.ini|karma\.conf)/i;

export function languageFromPath(p) {
  const ext = path.extname(p).slice(1).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? null;
}

export function isTestPath(p) {
  return RE_TEST_PATH.test(p) || RE_TEST_CONFIG.test(p);
}

export function hashId(input) {
  return createHash("sha256").update(String(input ?? "")).digest("hex").slice(0, 12);
}

// Given a list of tracked file paths, derive language/test-suite signal.
// Exported standalone so tests don't need a real git repo to exercise it.
export function summarizeFileList(files) {
  const counts = new Map();
  let testSuitePresent = false;
  for (const f of files) {
    if (!testSuitePresent && isTestPath(f)) testSuitePresent = true;
    const lang = languageFromPath(f);
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  let primaryLanguage = null;
  let best = 0;
  for (const [lang, n] of counts) {
    if (n > best) {
      best = n;
      primaryLanguage = lang;
    }
  }
  return { file_count: files.length, primary_language: primaryLanguage, test_suite_present: testSuitePresent };
}

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, timeout: GIT_TIMEOUT_MS, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function scanGitRepo(cwd) {
  const toplevel = sh("git rev-parse --show-toplevel", cwd);
  const filesRaw = sh("git ls-files", cwd);
  const files = filesRaw ? filesRaw.split("\n").filter(Boolean) : [];
  const { file_count, primary_language, test_suite_present } = summarizeFileList(files);

  let loc = null;
  try {
    const wcOut = sh("git ls-files -z | xargs -0 wc -l | tail -1", cwd);
    const n = parseInt(wcOut.trim().split(/\s+/)[0], 10);
    if (Number.isFinite(n)) loc = n;
  } catch {
    // huge repo / xargs hiccup / timeout — leave loc null rather than guess
  }

  let gitDirty = null;
  try {
    gitDirty = sh("git status --porcelain", cwd).length > 0;
  } catch {
    gitDirty = null;
  }

  let repoId;
  try {
    const remote = sh("git remote get-url origin", cwd);
    repoId = hashId(remote);
  } catch {
    repoId = hashId(toplevel);
  }

  return {
    repo_id: repoId,
    file_count,
    loc,
    primary_language,
    test_suite_present,
    git_dirty: gitDirty,
  };
}

function scanNonGitDir(cwd) {
  let file_count = null;
  try {
    const excludes = FALLBACK_EXCLUDES.map((d) => `-not -path "*/${d}/*"`).join(" ");
    const out = execSync(`find . -type f ${excludes} | wc -l`, {
      cwd,
      timeout: FALLBACK_FIND_TIMEOUT_MS,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    file_count = parseInt(out.trim(), 10);
    if (!Number.isFinite(file_count)) file_count = null;
  } catch {
    file_count = null;
  }

  return {
    repo_id: hashId(cwd),
    file_count,
    loc: null,
    primary_language: null,
    test_suite_present: null,
    git_dirty: null,
  };
}

// Bounded, defensive: never throws, never blocks longer than the timeouts
// above. Returns null only if cwd is unusable.
export function scanRepo(cwd) {
  if (!cwd || typeof cwd !== "string") return null;
  try {
    if (!fs.existsSync(cwd)) return null;
  } catch {
    return null;
  }

  try {
    sh("git rev-parse --is-inside-work-tree", cwd);
    return scanGitRepo(cwd);
  } catch {
    try {
      return scanNonGitDir(cwd);
    } catch {
      return null;
    }
  }
}
