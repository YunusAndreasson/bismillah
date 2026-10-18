import type { ChildProcess } from "node:child_process";
import { capabilities, freePort, startDriver } from "./driver.ts";

/**
 * WebdriverIO against the real app through tauri-driver (ADR-0009). Run it through
 * `pnpm test:e2e` / `pnpm test:visual`, which wrap it in scripts/headless.sh.
 */
const port = await freePort();
let driver: ChildProcess | undefined;

export const config: WebdriverIO.Config = {
  runner: "local",
  hostname: "127.0.0.1",
  port,
  specs: [],
  suites: {
    e2e: ["./e2e/**/*.e2e.ts"],
    visual: ["./visual/**/*.visual.ts"],
  },
  maxInstances: 1,
  capabilities: [capabilities()],
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  waitforTimeout: 10_000,
  async beforeSession() {
    driver = await startDriver(port);
  },
  afterSession() {
    driver?.kill();
  },
};
