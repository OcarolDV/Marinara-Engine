import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveBrowserCommand } from "../../open-browser.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const helperPath = join(repositoryRoot, "scripts/open-browser.mjs");
const url = "http://127.0.0.1:7860";

// Command resolution: the configured browser wins on every platform, and the
// platform default is used only when MARINARA_BROWSER is unset or blank.
assert.deepEqual(resolveBrowserCommand(url, { MARINARA_BROWSER: " C:\\Browsers\\brave.exe " }, "win32"), {
  command: "C:\\Browsers\\brave.exe",
  args: [url],
  configured: true,
  path: "C:\\Browsers\\brave.exe",
});
assert.deepEqual(resolveBrowserCommand(url, { MARINARA_BROWSER: "C:\\Browsers\\open.cmd" }, "win32"), {
  command: "cmd",
  args: ["/c", "C:\\Browsers\\open.cmd", url],
  configured: true,
  path: "C:\\Browsers\\open.cmd",
});
assert.deepEqual(resolveBrowserCommand(url, { MARINARA_BROWSER: "brave-browser" }, "linux"), {
  command: "brave-browser",
  args: [url],
  configured: true,
  path: "brave-browser",
});
assert.deepEqual(resolveBrowserCommand(url, { MARINARA_BROWSER: "" }, "win32"), {
  command: "cmd",
  args: ["/c", "start", "", url],
  configured: false,
});
assert.deepEqual(resolveBrowserCommand(url, {}, "darwin"), { command: "open", args: [url], configured: false });
assert.deepEqual(resolveBrowserCommand(url, { PREFIX: "/data/data/com.termux/files/usr" }, "linux"), {
  command: "termux-open-url",
  args: [url],
  configured: false,
});
assert.deepEqual(resolveBrowserCommand(url, {}, "linux"), { command: "xdg-open", args: [url], configured: false });

// End to end: a configured browser shim receives the URL as its only argument
// and the helper exits without touching the system default browser.
const temporaryDirectory = mkdtempSync(join(tmpdir(), "marinara-open-browser-"));
const recordPath = join(temporaryDirectory, "opened.txt");
const shimPath = join(temporaryDirectory, process.platform === "win32" ? "fake-browser.cmd" : "fake-browser.sh");
try {
  if (process.platform === "win32") {
    writeFileSync(shimPath, `@echo off\r\n(echo %*) > "${recordPath}"\r\n`);
  } else {
    writeFileSync(shimPath, `#!/bin/sh\nprintf '%s' "$*" > "${recordPath}"\n`);
    chmodSync(shimPath, 0o755);
  }

  const run = spawnSync(process.execPath, [helperPath, "--delay", "10", url], {
    encoding: "utf8",
    env: { ...process.env, MARINARA_BROWSER: shimPath },
  });
  assert.equal(run.status, 0, run.stderr);
  const deadline = Date.now() + 5_000;
  while (!existsSync(recordPath) && Date.now() < deadline) {
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 100)"]);
  }
  assert.equal(existsSync(recordPath), true, "the configured browser shim must be launched");
  assert.equal(readFileSync(recordPath, "utf8").trim(), url, "the shim receives the app URL as its argument");

  const usage = spawnSync(process.execPath, [helperPath], { encoding: "utf8" });
  assert.equal(usage.status, 2, "a missing URL is a usage error");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.info("Launcher open-browser regression checks passed.");
