import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("Windows executable launcher regression skipped on this platform.");
  process.exit(0);
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = mkdtempSync(join(tmpdir(), "marinara launcher "));
const install = join(fixture, "install with spaces");
const elsewhere = join(fixture, "other working directory");
mkdirSync(install);
mkdirSync(elsewhere);
const launcher = join(install, "MarinaraLauncher.exe");
copyFileSync(join(repositoryRoot, "MarinaraLauncher.exe"), launcher);

function run(args) {
  const result = spawnSync(launcher, args, { cwd: elsewhere, windowsHide: true, timeout: 5000 });
  assert.ifError(result.error);
  return result.status;
}

try {
  // Exit cmd itself: the interactive launcher deliberately uses /k.
  writeFileSync(join(install, "start.bat"), '@echo off\r\n> "default.txt" echo %CD%\r\nexit 17\r\n');
  assert.equal(run([]), 17, "Double-click must run start.bat beside the executable.");
  assert.equal(readFileSync(join(install, "default.txt"), "utf8").trim(), install);

  const customBat = join(elsewhere, "custom launch.bat");
  writeFileSync(customBat, '@echo off\r\n> "custom.txt" echo %CD%\r\nexit 23\r\n');
  assert.equal(run(["Marinara.Regression", customBat, "Custom launcher"]), 23);
  assert.equal(readFileSync(join(elsewhere, "custom.txt"), "utf8").trim(), elsewhere);
  assert.equal(run(["Marinara.Regression", customBat]), 23, "Two-argument shortcuts remain supported.");
  assert.equal(run(["--stamp-lnk"]), 2, "Incomplete shortcut stamping must not start the app.");
  assert.equal(run(["invalid"]), 2, "Malformed arguments must not start the app.");
  console.log("Windows executable launcher regressions passed.");
} finally {
  assert.equal(dirname(fixture), resolve(tmpdir()), "Only remove the temporary fixture created by this regression.");
  rmSync(fixture, { recursive: true, force: true });
}
