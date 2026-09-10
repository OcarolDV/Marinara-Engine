// Opens the app URL for the shell launchers.
//
// Honors MARINARA_BROWSER (a browser executable path or command name) so a
// launcher can always open a specific browser instead of the system default.
// Without it, uses the platform opener: `start` on Windows, `open` on macOS,
// `termux-open-url` inside Termux, and `xdg-open` elsewhere.
//
// Usage: node scripts/open-browser.mjs [--delay <ms>] <url>
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

function parseArguments(argv) {
  let delayMs = 0;
  let url = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--delay") {
      const value = Number(argv[index + 1]);
      delayMs = Number.isFinite(value) && value > 0 ? value : 0;
      index += 1;
    } else if (url === null) {
      url = argument;
    }
  }
  return { delayMs, url };
}

function isTermux(env) {
  return typeof env.PREFIX === "string" && env.PREFIX.includes("com.termux");
}

export function resolveBrowserCommand(url, env = process.env, platform = process.platform) {
  const configured = typeof env.MARINARA_BROWSER === "string" ? env.MARINARA_BROWSER.trim() : "";
  if (configured) {
    // Windows cannot spawn batch scripts directly; run them through cmd so a
    // .cmd wrapper works the same as an .exe.
    if (platform === "win32" && /\.(cmd|bat)$/i.test(configured)) {
      return { command: "cmd", args: ["/c", configured, url], configured: true, path: configured };
    }
    return { command: configured, args: [url], configured: true, path: configured };
  }
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url], configured: false };
  if (platform === "darwin") return { command: "open", args: [url], configured: false };
  if (isTermux(env)) return { command: "termux-open-url", args: [url], configured: false };
  return { command: "xdg-open", args: [url], configured: false };
}

function launch(target) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolvePromise(ok);
    };
    try {
      const child = spawn(target.command, target.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", () => finish(false));
      child.on("spawn", () => {
        child.unref();
        finish(true);
      });
    } catch {
      finish(false);
    }
  });
}

async function openUrl(url) {
  const target = resolveBrowserCommand(url);
  // A configured path (rather than a bare command name) must exist; `cmd /c`
  // would otherwise start fine and hide the failure.
  const configuredPathMissing = target.configured && /[\\/]/.test(target.path) && !existsSync(target.path);
  if (!configuredPathMissing && (await launch(target))) return true;
  if (!target.configured) return false;
  process.stderr.write(
    `  [WARN] MARINARA_BROWSER could not be started (${target.path}); opening the default browser instead.\n`,
  );
  const fallback = resolveBrowserCommand(url, { ...process.env, MARINARA_BROWSER: "" });
  return launch(fallback);
}

async function main() {
  const { delayMs, url } = parseArguments(process.argv.slice(2));
  if (!url) {
    process.stderr.write("Usage: node scripts/open-browser.mjs [--delay <ms>] <url>\n");
    process.exitCode = 2;
    return;
  }
  if (delayMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  if (!(await openUrl(url))) {
    process.stderr.write(`  [WARN] Could not open ${url} automatically. Open it in your browser.\n`);
    process.exitCode = 1;
  }
}

// pathToFileURL handles Windows drive letters; a bare `new URL(path, "file:")`
// would read "E:" as a URL scheme. Importing this module (tests) must not open anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
