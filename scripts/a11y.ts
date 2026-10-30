#!/usr/bin/env node
/**
 * The accessibility audit (DESIGN.md §16, PLAN.md Phase 6): reads bismillah's
 * accessibility tree, as a screen reader such as Orca gets it over AT-SPI, in every
 * screen and state, and checks it. Headless: a private accessibility bus inside
 * scripts/headless.sh, never the author's session.
 *
 *   pnpm a11y            (needs `pnpm app:build` first)
 *
 * Checks, in each state: every control (button, switch, radio, field, list or tree
 * item, menu item, link) has a name; every dialog has a name; and what that state must
 * offer (Search named by its scope, its rows as options with one selected, an opened
 * choice as radio buttons, a failure as an alert…). Prints what it found and
 * fails on any problem. What it can't check is what Orca says aloud.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { remote } from "webdriverio";
import { capabilities, freePort, REPO, startDriver } from "../tests/driver.ts";

interface A11yNode {
  role: string;
  name: string;
  description: string;
  states: string[];
  attributes: Record<string, string>;
  children: A11yNode[];
}

/** Roles a writer operates: each needs a name a screen reader can say. */
const CONTROLS = new Set([
  "button",
  "push button",
  "toggle button",
  "check box",
  "radio button",
  "entry",
  "combo box",
  "list item",
  "tree item",
  "menu item",
  "check menu item",
  "radio menu item",
  "link",
  "slider",
  "spin button",
  "switch",
  "page tab",
]);

// A private accessibility bus for the app and the reader, with its registry.
const bus = spawnSync(
  "dbus-daemon",
  [
    "--config-file=/usr/share/defaults/at-spi2/accessibility.conf",
    "--fork",
    "--print-address=1",
    "--print-pid=1",
  ],
  { encoding: "utf8" },
);
const [address, busPid] = bus.stdout.split("\n").map((line) => line.trim());
if (!address) throw new Error("couldn't start an accessibility bus");
process.env.AT_SPI_BUS_ADDRESS = address;
const registry = spawn("/usr/lib/at-spi2-registryd", [], { stdio: "ignore" });

function tree(): A11yNode {
  const out = execFileSync("/usr/bin/python3", ["-I", resolve(REPO, "scripts/a11y_tree.py")], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const root = JSON.parse(out) as A11yNode | null;
  if (!root) throw new Error("bismillah isn't on the accessibility bus");
  return root;
}

function* walk(node: A11yNode, path: string[] = []): Generator<[A11yNode, string[]]> {
  yield [node, path];
  for (const child of node.children) yield* walk(child, [...path, describe(node)]);
}

const describe = (n: A11yNode) => (n.name ? `${n.role} “${n.name}”` : n.role);

/** The webview's part of the tree (the native menu bar is GTK's own, checked apart). */
function web(root: A11yNode): A11yNode {
  for (const [node] of walk(root)) if (node.role === "document web") return node;
  throw new Error("no web document in the tree");
}

const find = (root: A11yNode, test: (n: A11yNode) => boolean) =>
  [...walk(root)].map(([n]) => n).filter(test);

interface Finding {
  state: string;
  problem: string;
}
const findings: Finding[] = [];
const summary: string[] = [];

/** The rules every state keeps, plus what this state must offer. */
function audit(state: string, expect: (doc: A11yNode, root: A11yNode) => string[] = () => []) {
  const root = tree();
  const doc = web(root);
  // A11Y_DUMP=<part of a state's name> prints that state's tree, to see what a reader gets.
  if (process.env.A11Y_DUMP && state.includes(process.env.A11Y_DUMP)) {
    for (const [node, path] of walk(doc)) {
      const attrs = Object.entries(node.attributes).map(([k, v]) => `${k}=${v}`);
      console.log(
        `${"  ".repeat(path.length)}${describe(node)}${node.description ? ` (${node.description})` : ""} [${[...node.states, ...attrs].join(" ")}]`,
      );
    }
  }
  let controls = 0;
  for (const [node, path] of walk(doc)) {
    if (CONTROLS.has(node.role)) {
      controls++;
      if (!node.name.trim()) {
        findings.push({
          state,
          problem: `${node.role} without a name (in ${path.slice(-3).join(" › ")})`,
        });
      }
    }
    if ((node.role === "dialog" || node.role === "alert dialog") && !node.name.trim()) {
      findings.push({ state, problem: `${node.role} without a name` });
    }
  }
  for (const problem of expect(doc, root)) findings.push({ state, problem });
  summary.push(`${state}: ${controls} named controls checked`);
}

const port = await freePort();
const driver = await startDriver(port);
const scratch = mkdtempSync(join(tmpdir(), "bismillah-a11y-"));
const library = join(scratch, "library");
cpSync(resolve(REPO, "tests/fixtures/library"), library, { recursive: true });
writeFileSync(join(library, "letter.md"), "# A letter\n\nDear friend,\n");

const browser = await remote({
  hostname: "127.0.0.1",
  port,
  logLevel: "error",
  capabilities: capabilities(),
});
const run = (id: string) => browser.execute((c: string) => window.__bismillah?.run(c as never), id);
const settle = () =>
  browser.execute(async () => {
    await window.__bismillah?.lintSettled();
    await window.__bismillah?.settle();
  });
const escape = async () => {
  await browser.keys(["Escape"]);
  await settle();
};
const showing = (n: A11yNode) => n.states.includes("showing");
const settingsFolder = join(process.env.XDG_CONFIG_HOME ?? "", "bismillah");
let settingsMode: number | undefined;

/** One screen or state: how to reach it, what it must offer, how to leave it. */
interface State {
  name: string;
  enter: () => Promise<unknown>;
  expect?: (doc: A11yNode, root: A11yNode) => string[];
  leave?: () => Promise<unknown>;
}

const STATES: State[] = [
  {
    name: "writing (the specimen)",
    enter: settle,
    expect: (doc, root) => {
      const out: string[] = [];
      const editor = find(doc, (n) => n.role === "entry" && n.states.includes("editable"));
      if (editor.length !== 1) out.push(`expected one writing surface, found ${editor.length}`);
      else if (!editor[0]?.name) out.push("the writing surface has no name");
      const status = find(
        doc,
        (n) => n.role === "status bar" || n.attributes["container-live"] === "polite",
      );
      if (!status.length) out.push("no status region for the save state");
      const menu = find(root, (n) => n.role === "menu bar");
      if (menu.length !== 1) out.push("no native menu bar");
      const unnamed = find(menu[0] ?? root, (n) => /menu item$/.test(n.role) && !n.name);
      if (unnamed.length) out.push(`${unnamed.length} menu items without a name`);
      return out;
    },
  },
  {
    name: "document search",
    enter: async () => {
      await run("edit.find");
      await browser.$(".cm-search").waitForDisplayed();
      await settle();
    },
    expect: (doc) => {
      const fields = find(doc, (n) => n.role === "entry").map((n) => n.name);
      return ["Find", "Replace"]
        .filter((label) => !fields.includes(label))
        .map((label) => `no named ${label} field`);
    },
    leave: escape,
  },
  {
    name: "invalid search expression",
    enter: async () => {
      await run("edit.find");
      await browser.execute(() => {
        const field = document.querySelector<HTMLInputElement>('.cm-search input[name="search"]');
        const regex = document.querySelector<HTMLInputElement>('.cm-search input[name="re"]');
        if (regex && !regex.checked) regex.click();
        if (field) {
          field.value = "[";
          field.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await settle();
    },
    expect: (doc) =>
      find(
        doc,
        (n) =>
          n.role === "entry" &&
          n.name === "Find" &&
          n.description.includes("Invalid regular expression"),
      ).length
        ? []
        : ["the Find field doesn't describe its invalid expression"],
    leave: escape,
  },
  {
    name: "go to line",
    enter: async () => {
      await run("edit.goToLine");
      await browser.$(".cm-goto-line").waitForDisplayed();
      await settle();
    },
    expect: (doc) =>
      find(doc, (n) => n.role === "entry" && n.name.startsWith("Go to line")).length
        ? []
        : ["no named Go to line field"],
    leave: escape,
  },
  {
    name: "invalid line position",
    enter: async () => {
      await run("edit.goToLine");
      await browser.$(".cm-goto-line input").setValue("not a position");
      await browser.keys("Enter");
      await settle();
    },
    expect: (doc) =>
      find(
        doc,
        (n) =>
          n.role === "entry" &&
          n.name.startsWith("Go to line") &&
          n.states.includes("invalid") &&
          n.description.includes("Your position hasn't changed"),
      ).length
        ? []
        : ["invalid navigation is not described beside the field"],
    leave: escape,
  },
  {
    name: "the guide",
    enter: async () => {
      await run("app.guide");
      await settle();
    },
  },
  {
    name: "Settings",
    enter: async () => {
      await browser.execute(() => window.__bismillah?.openSettings(null));
      await browser.$(".panel").waitForDisplayed();
      await settle();
    },
    expect: (doc) => {
      const out: string[] = [];
      const dialog = find(doc, (n) => n.role === "dialog" && showing(n));
      // Search, narrowed to settings: the dialog and its field both say so.
      if (dialog[0]?.name !== "Search settings")
        out.push(`Search is named “${dialog[0]?.name ?? ""}”`);
      // The highlighted option reads as focused (aria-activedescendant): find the field.
      const field = find(doc, (n) => /^(entry|combo box)$/.test(n.role) && showing(n));
      if (field[0]?.name !== "Search settings")
        out.push(`the search field is named “${field[0]?.name ?? ""}”`);
      const options = find(doc, (n) => n.role === "list item" && showing(n));
      if (options.length < 8) out.push(`only ${options.length} settings are listed as options`);
      if (!options.some((n) => n.states.includes("selected"))) out.push("no setting is selected");
      if (find(doc, (n) => /tab$/.test(n.role) && showing(n)).length > 0)
        out.push("Search still has tabs");
      return out;
    },
    leave: escape,
  },
  {
    name: "a setting opened in place",
    enter: async () => {
      await browser.execute(() => window.__bismillah?.openSettings({ row: "measure", open: true }));
      await browser.$(".panel-opened").waitForDisplayed();
      await settle();
    },
    expect: (doc) => {
      const out: string[] = [];
      const radios = find(doc, (n) => n.role === "radio button" && showing(n));
      if (radios.length !== 3) out.push(`${radios.length} radio buttons for Line length`);
      if (!radios.some((n) => n.states.includes("checked"))) out.push("no radio button is checked");
      if (!radios.some((n) => n.states.includes("focused"))) out.push("no radio button has focus");
      return out;
    },
    leave: async () => {
      await escape();
      await escape();
    },
  },
  {
    name: "the formatting bar",
    enter: async () => {
      await browser.execute(() => {
        const view = window.__bismillah?.view;
        if (!view) return;
        const text = view.state.doc.toString();
        // Past the frontmatter, where the bar stays away.
        const body = text.indexOf("\n---", 3) + 4;
        const at = body + text.slice(body).search(/\n[A-Z][a-z]+ [a-z]{4,}/) + 1;
        view.focus();
        view.dispatch({ selection: { anchor: at, head: at + 4 }, userEvent: "select" });
      });
      await browser.$(".format-bar").waitForExist();
      await settle();
    },
    expect: (doc) => {
      const out: string[] = [];
      const bar = find(doc, (n) => n.role === "tool bar" && n.name === "Formatting" && showing(n));
      if (bar.length !== 1) out.push(`${bar.length} toolbars named Formatting`);
      const names = find(doc, (n) => /button$/.test(n.role) && showing(n)).map((n) => n.name);
      for (const name of ["Bold", "Italic", "Strikethrough", "Code"])
        if (!names.includes(name)) out.push(`no button named ${name}`);
      // WebKit gives a button that opens a menu the role of a combo box.
      const menus = find(doc, (n) => n.role === "combo box" && showing(n)).map((n) => n.name);
      if (!menus.some((name) => name.startsWith("Turn into:"))) out.push("no Turn into menu");
      if (!menus.some((name) => name.startsWith("Writing font:"))) out.push("no font menu");
      return out;
    },
    leave: async () => {
      await browser.execute(() => {
        const view = window.__bismillah?.view;
        view?.dispatch({ selection: { anchor: view.state.selection.main.head } });
      });
      await settle();
    },
  },
  {
    name: "Settings could not be saved",
    enter: async () => {
      await browser.execute(async () => {
        await window.__bismillah?.changeSettings({ theme: "light" });
        window.__bismillah?.openSettings({ row: "theme", open: true });
      });
      await browser.$(".panel").waitForDisplayed();
      settingsMode = statSync(settingsFolder).mode & 0o777;
      chmodSync(settingsFolder, 0o555);
      await browser.$(".panel").$("button=Dark").click();
      await browser.$(".panel-save-error").waitForDisplayed();
      await settle();
    },
    expect: (doc) => {
      const dialog = find(doc, (n) => n.role === "dialog" && showing(n))[0];
      return dialog &&
        find(
          dialog,
          (n) =>
            (n.attributes["xml-roles"] === "alert" || /alert|notification/.test(n.role)) &&
            showing(n),
        ).length &&
        find(dialog, (n) => /button$/.test(n.role) && n.name === "Try again" && showing(n)).length
        ? []
        : ["Settings has no visible alert and named retry control"];
    },
    leave: async () => {
      if (settingsMode !== undefined) chmodSync(settingsFolder, settingsMode);
      await browser.execute(async () => window.__bismillah?.changeSettings({ theme: "system" }));
      await escape();
      await escape();
    },
  },
  {
    name: "About",
    enter: async () => {
      await run("app.about");
      await browser.$(".about-dialog").waitForDisplayed();
    },
    expect: (doc) => {
      // Named by its visible title, the app's name, and described by its one line.
      const dialog = find(doc, (n) => n.role === "dialog" && showing(n));
      return dialog[0]?.name === "bismillah" && dialog[0].description
        ? []
        : ["About isn't named by its title and described by its tagline"];
    },
    leave: escape,
  },
  {
    name: "Search",
    enter: async () => {
      await browser.execute(
        async (folder: string, file: string) => {
          await window.__bismillah?.setLibrary(folder);
          await window.__bismillah?.open(file);
        },
        library,
        join(library, "letter.md"),
      );
      await run("app.findAnything");
      await browser.keys([..."let"]);
      await settle();
    },
    expect: (doc) => {
      const out: string[] = [];
      const dialog = find(doc, (n) => n.role === "dialog" && showing(n));
      if (dialog[0]?.name !== "Search") out.push("Search isn't a named dialog");
      const field = find(doc, (n) => /^(entry|combo box)$/.test(n.role) && showing(n));
      if (field[0]?.name !== "Search") out.push("the search field isn't named Search");
      const options = find(doc, (n) => n.role === "list item" && showing(n));
      if (!options.some((n) => n.name.includes("letter")))
        out.push("no file is listed as an option");
      if (!options.some((n) => n.states.includes("selected"))) out.push("no option is selected");
      return out;
    },
    leave: escape,
  },
  {
    name: "Commands",
    enter: async () => {
      await run("app.commandPalette");
      await browser.keys([..."zuhd"]);
      await settle();
    },
    expect: (doc) => {
      const options = find(doc, (n) => n.role === "list item" && showing(n));
      return options.some((n) => n.name.includes("Zuhd mode"))
        ? []
        : ["Commands doesn't list Zuhd mode as an option"];
    },
    leave: escape,
  },
  {
    name: "Rename…",
    enter: async () => {
      await run("file.rename");
      await browser.$(".prompt").waitForDisplayed();
    },
    expect: (doc) => {
      const field = find(doc, (n) => n.role === "entry" && n.states.includes("focused"));
      return field[0]?.name ? [] : ["the name field has no name"];
    },
    leave: escape,
  },
  {
    name: "the suggestions",
    enter: async () => {
      await browser.execute(async () => {
        await window.__bismillah?.setDoc("I will recieve the letter tomorow.\n");
      });
      await settle();
      await run("check.next");
      await browser.$(".suggestions").waitForDisplayed();
    },
    expect: (doc) => {
      const out: string[] = [];
      const menu = find(doc, (n) => n.role === "menu" && showing(n));
      if (!menu[0]?.name) out.push("the suggestions aren't a named menu");
      const items = menu[0] ? find(menu[0], (n) => n.role === "menu item") : [];
      if (!items.some((n) => n.name === "Add to dictionary")) out.push("no Add to dictionary item");
      return out;
    },
    leave: escape,
  },
  {
    name: "a save that failed",
    enter: async () => {
      await browser.execute(async () => {
        await window.__bismillah?.fault("disk_full");
        await window.__bismillah?.setDoc("A change that can't be saved.\n");
        await window.__bismillah?.flush();
      });
      await browser.waitUntil(
        () => browser.execute(() => (window.__bismillah?.notices().length ?? 0) > 0),
        { timeout: 5000 },
      );
    },
    expect: (doc) => {
      const alerts = find(
        doc,
        (n) => /alert|notification/.test(n.role) || n.attributes["container-live"] === "assertive",
      );
      return alerts.some((n) => showing(n)) ? [] : ["the failure isn't an alert"];
    },
    leave: () =>
      browser.execute(async () => {
        await window.__bismillah?.fault(null);
        await window.__bismillah?.flush();
      }),
  },
  {
    name: "nothing open",
    enter: async () => {
      await browser.execute(() => window.__bismillah?.welcome());
      await settle();
    },
    expect: (doc) => {
      const buttons = find(doc, (n) => /button$/.test(n.role) && showing(n)).map((n) => n.name);
      return ["Open a folder…", "Open a file…", "New file…", "Guide"].every((b) =>
        buttons.some((name) => name.startsWith(b)),
      )
        ? []
        : [`the first screen offers ${buttons.join(", ")}`];
    },
  },
];

try {
  await browser.waitUntil(
    () => browser.execute(() => document.documentElement.dataset.ready === "true"),
    { timeout: 30_000 },
  );
  for (const state of STATES) {
    try {
      await state.enter();
      audit(state.name, state.expect);
    } catch (error) {
      findings.push({ state: state.name, problem: `couldn't be reached: ${String(error)}` });
    }
    await state.leave?.().catch(() => {});
  }
} finally {
  await browser.deleteSession().catch(() => {});
  driver.kill();
  registry.kill();
  if (busPid) process.kill(Number(busPid));
  rmSync(scratch, { recursive: true, force: true });
}

console.log("\nAccessibility (AT-SPI, as Orca reads it)");
for (const line of summary) console.log(`  ${line}`);
if (findings.length) {
  console.log("\nProblems:");
  for (const f of findings) console.log(`  ${f.state}: ${f.problem}`);
  process.exit(1);
}
console.log("  no problems found");
