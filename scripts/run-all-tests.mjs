/** Run every project's unit-test file with Node's test runner.
 * Uses explicit arguments rather than shell wildcards, so Windows PowerShell and
 * Linux execute the same suite. Requires npm install (tsx dev dependency).
 */
import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(root, "tests");
const names = (await readdir(testsDir)).filter(name => /\.test\.(?:mjs|mts)$/.test(name)).sort();
if (names.length === 0) {
  console.error("No tests discovered in tests/; refusing to report success.");
  process.exitCode = 1;
} else {
  console.log(`Running ${names.length} test files using tsx.`);
  const args = ["--import", "tsx", "--test", ...names.map(name => path.join(testsDir, name))];
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
  child.on("error", error => { console.error("Test runner failed:", error); process.exitCode = 1; });
  child.on("exit", (code, signal) => {
    if (signal) console.error(`Test runner terminated by ${signal}`);
    process.exitCode = code ?? 1;
  });
}
