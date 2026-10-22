import type { ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { remote } from "webdriverio";
import { capabilities, freePort, REPO, startDriver } from "../driver.ts";

/**
 * The bismillah stick's screens (os/PLAN.md, OS-2 and OS-3) in the real app, against a
 * stand-in for the helper. The app runs with `--appliance`, a scratch `HOME` (appliance
 * mode keeps its files there) and the stand-in's socket (`BISMILLAH_HELPER_SOCKET`,
 * debug builds only). The real helper, and the stick it formats, are tested in VMs
 * (os/scripts/test.ts).
 *
 * This spec starts its own driver with that environment, so it ends wdio's session.
 * Screenshots for the design review go to target/appliance-shots/.
 */

type Json = Record<string, unknown>;
type Respond = (request: Json) => Json;

const scratch = mkdtempSync(join(tmpdir(), "bismillah-appliance-"));
const home = join(scratch, "home");
const socket = join(scratch, "helper.sock");
const shots = join(REPO, "target/appliance-shots");
const requests: Json[] = [];
/** The app's events connections (the lock handshake), newest last, and its reports. */
const events: Socket[] = [];
const reports: Json[] = [];
const power = join(scratch, "power");
let respond: Respond = () => ({ answer: "failed", step: "unset" });
let server: Server;
let driver: ChildProcess;
let port = 0;

const keyboard = (source = "pending", layouts = "se,ara") => ({
  layouts,
  options: layouts.includes(",") ? "grp:alt_shift_toggle" : "",
  source,
});
const status = (state: Json, source = "pending", layouts = "se,ara") => ({
  answer: "status",
  home: state,
  keyboard: keyboard(source, layouts),
  resume: false,
});

/** What the helper's setup leaves behind: home's folders. */
function makeHome() {
  for (const dir of ["Texts", ".config/bismillah", ".local/share/bismillah"]) {
    mkdirSync(join(home, dir), { recursive: true });
  }
}

async function app() {
  const session = await remote({
    hostname: "127.0.0.1",
    port,
    logLevel: "warn",
    capabilities: capabilities(["--appliance"]),
  });
  await session.$("main.screen h1").waitForDisplayed({ timeout: 20_000 });
  return session;
}

async function heading(session: WebdriverIO.Browser) {
  return session.$("main.screen h1").getText();
}

async function shot(session: WebdriverIO.Browser, name: string) {
  mkdirSync(shots, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await session.execute((t) => (document.documentElement.dataset.theme = t), theme);
    await session.pause(100);
    await session.saveScreenshot(join(shots, `${name}-${theme}.png`));
  }
  await session.execute(() => delete document.documentElement.dataset.theme);
}

/** Types into the focused element, as a keyboard would. */
async function type(session: WebdriverIO.Browser, text: string) {
  // One character per action: WebKitWebDriver drops some spaces in a longer sequence.
  for (const character of text) await session.keys(character);
}

describe("the stick's first screens", () => {
  before(async () => {
    await browser.deleteSession().catch(() => undefined);
    mkdirSync(home, { recursive: true });
    server = createServer((connection) => {
      let line = "";
      let held = false;
      connection.on("error", () => undefined);
      connection.on("data", (chunk) => {
        line += chunk.toString("utf8");
        // The events connection stays open: the app's reports follow its request.
        if (held) {
          for (const report of line.split("\n").slice(0, -1))
            reports.push(JSON.parse(report) as Json);
          line = line.slice(line.lastIndexOf("\n") + 1);
          return;
        }
        if (!line.includes("\n")) return;
        const request = JSON.parse(line.slice(0, line.indexOf("\n"))) as Json;
        if (request.verb === "events") {
          held = true;
          line = line.slice(line.indexOf("\n") + 1);
          events.push(connection);
          return;
        }
        requests.push(request);
        connection.end(`${JSON.stringify(respond(request))}\n`);
      });
    });
    await new Promise<void>((done) => server.listen(socket, done));
    port = await freePort();
    // A battery at 9%, discharging: the low-battery notice.
    mkdirSync(join(power, "BAT0"), { recursive: true });
    for (const [file, value] of [
      ["type", "Battery"],
      ["capacity", "9"],
      ["status", "Discharging"],
    ] as const)
      writeFileSync(join(power, "BAT0", file), `${value}\n`);
    driver = await startDriver(port, {
      HOME: home,
      XDG_RUNTIME_DIR: join(scratch, "run"),
      BISMILLAH_HELPER_SOCKET: socket,
      BISMILLAH_POWER_SUPPLY: power,
    });
    mkdirSync(join(scratch, "run"), { recursive: true, mode: 0o700 });
  });

  after(() => {
    driver.kill();
    for (const connection of events) connection.destroy();
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  beforeEach(() => {
    requests.length = 0;
    reports.length = 0;
  });

  it("sets up a blank stick: keyboard, passphrase, time zone", async () => {
    // Step 1, the keyboard. Choosing restarts the session (the app exits), so the
    // stand-in refuses here, and the request is what's checked.
    respond = (r) =>
      r.verb === "status"
        ? status({ state: "blank" }, "default", "us")
        : { answer: "invalid_keyboard" };
    let session = await app();
    try {
      expect(await heading(session)).toBe("Choose your keyboard");
      await shot(session, "setup-keyboard");
      await session.$("#first-layout").selectByAttribute("value", "se");
      await session.$("#second-layout").selectByAttribute("value", "ara");
      await session.$("button[type=submit]").click();
      await session.waitUntil(() => requests.some((r) => r.verb === "set_keyboard"));
      expect(requests.find((r) => r.verb === "set_keyboard")).toEqual({
        v: 1,
        verb: "set_keyboard",
        layouts: "se,ara",
        options: "grp:alt_shift_toggle",
      });
      await session.$(".problem").waitForDisplayed();
    } finally {
      await session.deleteSession();
    }

    // After the restart the layouts are pending: step 2, the passphrase.
    // Arabic last: under Xvfb, WebDriver loses spaces typed after Arabic letters (its
    // synthesized keymap); the VMs type through real layouts (os/scripts/test.ts).
    const typed = "lantern orbit velvet åäö بلا";
    respond = (r) => {
      if (r.verb === "status") return status({ state: "blank" });
      makeHome();
      return { answer: "ok" };
    };
    session = await app();
    try {
      expect(await heading(session)).toBe("Choose a passphrase");
      const next = session.$("button.primary");
      await type(session, "password");
      await session
        .$("p#strength=Too easy to guess. Try more words, or a suggested passphrase.")
        .waitForExist();
      expect(await next.isEnabled()).toBe(false);
      // A suggestion fills both fields, shows them, and is strong enough.
      await session.$("button=Suggest a passphrase").click();
      await session.$("p#strength=Strong enough.").waitForExist();
      const words = await session.$("#passphrase").getValue();
      expect(words.split(" ")).toHaveLength(6);
      expect(await session.$("#again").getValue()).toBe(words);
      expect(await session.$("#passphrase").getAttribute("type")).toBe("text");
      expect(await next.isEnabled()).toBe(true);
      await shot(session, "setup-passphrase");

      // The writer's own, typed twice: a mismatch is said, and blocks Continue.
      await session.$("#passphrase").clearValue();
      await session.$("#again").clearValue();
      await session.$("#passphrase").click();
      await type(session, typed);
      await session.$("#again").click();
      await type(session, `${typed}x`);
      await session.$("p#strength=The two passphrases are different.").waitForExist();
      expect(await next.isEnabled()).toBe(false);
      await session.keys(["Backspace"]);
      await session.$("p#strength=Strong enough.").waitForExist();
      expect(await session.$("p.statement").getText()).toBe(
        "There is no way to recover your texts without this passphrase.",
      );
      await next.click();

      // Step 3, the time zone; then the helper sets up and the app opens.
      expect(await heading(session)).toBe("Choose your time zone");
      await session.$("#time-zone").selectByAttribute("value", "Europe/Stockholm");
      await shot(session, "setup-time");
      await session.$("button=Set up the stick").click();
      await session.$("main.screen").waitForExist({ reverse: true, timeout: 20_000 });
      const setup = requests.find((r) => r.verb === "setup");
      // Exactly the characters typed, Swedish and Arabic included.
      expect(setup).toEqual({ v: 1, verb: "setup", passphrase: typed });
      const settings = join(home, ".config/bismillah/settings.toml");
      await session.waitUntil(
        () => existsSync(settings) && readFileSync(settings, "utf8").includes("time_zone"),
      );
      expect(readFileSync(settings, "utf8")).toContain('time_zone = "Europe/Stockholm"');
    } finally {
      await session.deleteSession();
    }
  });

  it("unlocks a ready stick, and says so calmly when the passphrase is wrong", async () => {
    respond = (r) => {
      if (r.verb === "status") return status({ state: "ready" }, "token");
      return r.passphrase === "right words here"
        ? { answer: "ok" }
        : { answer: "wrong_passphrase" };
    };
    const session = await app();
    try {
      expect(await heading(session)).toBe("Passphrase");
      // Keyboard only: the field has focus; Enter submits.
      await type(session, "wrong");
      await session.keys(["Enter"]);
      const problem = session.$("#unlock-problem.problem");
      await problem.waitForDisplayed();
      expect(await problem.getText()).toBe(
        "That passphrase didn't unlock your texts. Check the keyboard layout and Caps Lock, then try again.",
      );
      expect(await session.$("#passphrase").getValue()).toBe("");
      await shot(session, "unlock-wrong");
      await session.$("#passphrase").click();
      await type(session, "right words here");
      await session.keys(["Enter"]);
      await session.$("main.screen").waitForExist({ reverse: true, timeout: 20_000 });
      expect(requests.filter((r) => r.verb === "unlock")).toHaveLength(2);
    } finally {
      await session.deleteSession();
    }
  });

  it("follows the visible order with Tab, and powers off from the keyboard", async () => {
    respond = (r) =>
      r.verb === "status" ? status({ state: "ready" }, "damaged", "us") : { answer: "ok" };
    const session = await app();
    try {
      expect(
        await session
          .$("p=Your keyboard layouts couldn't be read, so this screen uses English (US).")
          .isDisplayed(),
      ).toBe(true);
      const focused = () =>
        session.execute(() => {
          const e = document.activeElement as HTMLElement | null;
          const label = e?.closest("label")?.textContent?.trim();
          return e?.id || label || e?.textContent?.trim() || "";
        });
      expect(await focused()).toBe("passphrase");
      await session.keys(["Tab"]);
      expect(await focused()).toBe("Show passphrase");
      await session.keys(["Tab"]);
      // Unlock is disabled until something is typed, so focus moves on to Power off.
      expect(await focused()).toBe("Power off");
      await shot(session, "unlock");
      await session.keys(["Enter"]);
      await session.waitUntil(() => requests.some((r) => r.verb === "power"));
      expect(requests.find((r) => r.verb === "power")).toEqual({
        v: 1,
        verb: "power",
        action: "off",
      });
    } finally {
      await session.deleteSession();
    }
  });

  it("finishes an interrupted setup, or starts over only after typing the confirmation", async () => {
    let state: Json = { state: "initialising" };
    respond = (r) => {
      // Starting over keeps the layouts, pending, for the next setup.
      if (r.verb === "status") return status(state, state.state === "blank" ? "pending" : "token");
      if (r.verb === "start_over") {
        state = { state: "blank" };
        return { answer: "ok" };
      }
      return { answer: "wrong_passphrase" };
    };
    const session = await app();
    try {
      expect(await heading(session)).toBe("Setup didn't finish");
      await type(session, "not it");
      await session.keys(["Enter"]);
      await session.$("#finish-problem.problem").waitForDisplayed();
      await shot(session, "finish");
      await session.$("button=Start over…").click();
      const erase = session.$("button=Erase and start over");
      expect(await erase.isEnabled()).toBe(false);
      await type(session, "start");
      expect(await erase.isEnabled()).toBe(false);
      await type(session, " over");
      await shot(session, "finish-start-over");
      expect(requests.some((r) => r.verb === "start_over")).toBe(false);
      await erase.click();
      await session.waitUntil(async () => (await heading(session)) === "Choose a passphrase");
      expect(requests.filter((r) => r.verb === "start_over")).toHaveLength(1);
    } finally {
      await session.deleteSession();
    }
  });

  it("refuses to touch a stick it can't read, or when two sticks are attached", async () => {
    for (const [state, title, restart] of [
      [
        { state: "unreadable", reason: "unknown_token" },
        "This stick's texts can't be opened",
        false,
      ],
      [{ state: "not_found", reason: "two_sticks" }, "Two bismillah sticks are attached", true],
    ] as const) {
      respond = (r) => (r.verb === "status" ? status(state, "default", "us") : { answer: "ok" });
      const session = await app();
      try {
        expect(await heading(session)).toBe(title);
        // No passphrase field: nothing here can unlock, format or erase.
        expect(await session.$("input").isExisting()).toBe(false);
        expect(await session.$("button=Restart").isExisting()).toBe(restart);
        await shot(session, state.state === "unreadable" ? "unreadable" : "two-sticks");
        expect(requests.filter((r) => r.verb !== "status")).toEqual([]);
      } finally {
        await session.deleteSession();
      }
    }
  });

  it("once open: the clock and battery, power instead of Quit, the lock, This stick", async () => {
    respond = (r) => {
      if (r.verb === "status") return status({ state: "ready" }, "token");
      if (r.verb === "set_keyboard") return { answer: "invalid_keyboard" };
      if (r.verb === "unlock" || r.verb === "verify")
        return r.passphrase === "right words here"
          ? { answer: "ok" }
          : { answer: "wrong_passphrase" };
      return { answer: "ok" };
    };
    makeHome();
    writeFileSync(join(home, "Texts/note.md"), "A line only the writer may see.\n");
    const session = await app();
    try {
      await type(session, "right words here");
      await session.keys(["Enter"]);
      await session.$("main.screen").waitForExist({ reverse: true, timeout: 20_000 });
      // The status line ends with the battery and a 24-hour clock; 9% warns.
      const clock = session.$("footer.status time.clock");
      await clock.waitForExist({ timeout: 10_000 });
      expect(await clock.getText()).toMatch(/^\d\d:\d\d$/);
      expect(await session.$("footer.status .battery").getText()).toBe("9%");
      await session
        .$("p*=The battery is at 9%. Plug the computer in")
        .waitForExist({ timeout: 10_000 });

      // The palette offers Power off, Lock, Suspend and Restart, not Quit or Open….
      await session.keys(["Control", "Shift", "p"]);
      const palette = session.$('[role="dialog"]');
      await palette.waitForDisplayed();
      const names = await session.execute(() =>
        [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent),
      );
      const offered = names.join("\n");
      for (const label of ["Power off", "Lock", "Suspend", "Restart"])
        expect(offered).toContain(label);
      for (const label of ["Quit", "Open…", "Open folder…", "Copy as rich text", "Fullscreen"])
        expect(names.some((n) => n?.startsWith(label))).toBe(false);
      await session.keys(["Escape"]);

      // The helper asks for the lock: the lock view covers the text, and is reported.
      await session.waitUntil(() => events.length > 0, { timeout: 10_000 });
      events.at(-1)?.write('{"event":"lock"}\n');
      await session.waitUntil(async () => (await heading(session).catch(() => "")) === "Locked");
      await session.waitUntil(() => reports.some((r) => r.report === "painted"));
      expect(await session.$("#passphrase").isFocused()).toBe(true);
      await shot(session, "locked");
      // Nothing behind it acts: Ctrl+Q would power off.
      await session.keys(["Control", "q"]);
      await session.pause(300);
      expect(requests.some((r) => r.verb === "power")).toBe(false);
      await type(session, "right words here");
      await session.keys(["Enter"]);
      await session.$("main.screen").waitForExist({ reverse: true, timeout: 10_000 });
      expect(requests.filter((r) => r.verb === "verify")).toEqual([
        { v: 1, verb: "verify", passphrase: "right words here" },
      ]);

      // A page loaded again once the app has started (WebKit's Reload, a restarted web
      // process) opens behind the lock view: it can't know whether the stick was locked.
      await session.refresh();
      await session.waitUntil(async () => (await heading(session).catch(() => "")) === "Locked", {
        timeout: 20_000,
      });
      await type(session, "right words here");
      await session.keys(["Enter"]);
      await session.$("main.screen").waitForExist({ reverse: true, timeout: 20_000 });
      // And WebKit's own page menu (Back, Reload) never opens; fields keep theirs.
      const menus = await session.execute(() => {
        const ask = (target: Element) =>
          target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        const field = document.createElement("input");
        document.body.append(field);
        const answer = { page: ask(document.body), field: ask(field) };
        field.remove();
        return answer;
      });
      expect(menus).toEqual({ page: false, field: true });

      // A path typed into a native dialog stays in the library: elsewhere is RAM, or
      // someone else's disk, and a text saved there would vanish at power-off.
      const outside = join(scratch, "elsewhere.md");
      await session.execute((p) => window.__bismillah?.nextDialog(p), outside);
      await session.keys(["Control", "n"]);
      await session.$("p*=only the library is kept on the stick").waitForExist({ timeout: 10_000 });
      expect(existsSync(outside)).toBe(false);
      const inside = join(home, "Texts/inside.md");
      await session.execute((p) => window.__bismillah?.nextDialog(p), inside);
      await session.keys(["Control", "n"]);
      await session.waitUntil(() => existsSync(inside), { timeout: 10_000 });

      // Settings › This stick: the keyboard, applied in one step, and the clock.
      await session.keys(["Control", ","]);
      await session.$("#settings-stick").waitForExist();
      await session.$("#settings-stick").scrollIntoView();
      expect(await session.$("#set-local-clock").isExisting()).toBe(true);
      expect(await session.$("button=Show in file manager").isExisting()).toBe(false);
      await session.$("#set-layout-1").selectByAttribute("value", "ara");
      await session.$("#set-switch").waitForExist();
      await shot(session, "settings-stick");
      await session.$("button=Apply layouts").click();
      await session.waitUntil(() => requests.some((r) => r.verb === "set_keyboard"));
      // The e2e session has no XKB layouts of its own, so it starts from English (US).
      expect(requests.find((r) => r.verb === "set_keyboard")).toMatchObject({
        layouts: "us,ara",
        options: "grp:alt_shift_toggle",
      });
      await session.$("p=That keyboard layout isn't one this stick knows.").waitForExist();
      await session.keys(["Escape"]);

      // Ctrl+Q powers off, after saving.
      await session.keys(["Control", "q"]);
      await session.waitUntil(() => requests.some((r) => r.verb === "power"));
      expect(requests.find((r) => r.verb === "power")).toEqual({
        v: 1,
        verb: "power",
        action: "off",
      });
    } finally {
      await session.deleteSession();
    }
  });

  it("keeps the passphrase out of everything the app wrote", () => {
    // The stand-in's home holds what appliance mode wrote: settings, state, recovery.
    const leaked: string[] = [];
    const walk = (dir: string) => {
      for (const name of existsSync(dir) ? readdirSafe(dir) : []) {
        const path = join(dir, name);
        try {
          if (readFileSync(path, "utf8").includes("lantern orbit velvet")) leaked.push(path);
        } catch {
          walk(path);
        }
      }
    };
    walk(home);
    expect(leaked).toEqual([]);
  });
});

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
