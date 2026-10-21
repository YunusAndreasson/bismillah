import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** The debug app built by `pnpm app:build` (embedded frontend, no dev server). */
export const APP_BINARY = resolve(import.meta.dirname, "../target/debug/bismillah");
export const REPO = resolve(import.meta.dirname, "..");

export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.unref();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? done(address.port) : fail(new Error("no port")),
      );
    });
  });
}

function tauriDriverPath(): string {
  const candidates = [
    process.env.TAURI_DRIVER,
    resolve(homedir(), ".local/bin/tauri-driver"),
    resolve(homedir(), ".cargo/bin/tauri-driver"),
  ];
  for (const path of candidates) if (path && existsSync(path)) return path;
  return "tauri-driver";
}

/** Starts tauri-driver on a free port and resolves once it accepts connections. `env`
 * adds to the environment the app inherits (tests/e2e/appliance.e2e.ts). */
export async function startDriver(
  port: number,
  env: Record<string, string> = {},
): Promise<ChildProcess> {
  // Never open the app on the author's desktop: only scripts/headless.sh sets this.
  if (!process.env.BISMILLAH_TEST || process.env.WAYLAND_DISPLAY) {
    throw new Error("Run this through scripts/headless.sh (pnpm test:e2e / pnpm app:shot).");
  }
  const nativePort = await freePort();
  const child = spawn(
    tauriDriverPath(),
    [
      "--port",
      String(port),
      "--native-port",
      String(nativePort),
      "--native-driver",
      "/usr/bin/WebKitWebDriver",
    ],
    { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, ...env } },
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    const ok = await fetch(`http://127.0.0.1:${port}/status`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return child;
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("tauri-driver did not start");
}

export function capabilities(args: string[] = []): WebdriverIO.Capabilities {
  if (!existsSync(APP_BINARY)) {
    throw new Error(`No app binary at ${APP_BINARY}. Run \`pnpm app:build\` first.`);
  }
  return { "tauri:options": { application: APP_BINARY, args } } as WebdriverIO.Capabilities;
}
