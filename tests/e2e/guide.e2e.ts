import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { settle, waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";
import { Folder, open, typeAtEnd } from "./files.ts";

/**
 * Help › Guide (PLAN.md Phase 6): the bundled guide opens as a sample that is never
 * saved, on F1 and from the palette, without a single spelling or grammar mark, and its
 * own vocabulary stays ignored in the guide alone.
 */

const guide = readFileSync(resolve(REPO, "docs/guide.md"), "utf8");

const status = () => browser.execute(() => window.__bismillah?.status() ?? "");
const text = () => browser.execute(() => window.__bismillah?.view.state.doc.toString() ?? "");

describe("the guide", () => {
  const folder = new Folder();

  before(async () => {
    await waitForApp(browser);
    await browser.execute(() => window.__bismillah?.view.focus());
  });

  after(() => folder.remove());

  it("opens on F1 as a sample, titled by its name", async () => {
    await browser.keys(["F1"]);
    await browser.waitUntil(async () => (await text()) === guide, {
      timeout: 5000,
      timeoutMsg: "F1 didn't open the guide",
    });
    expect(await browser.getTitle()).toBe("guide.md — bismillah");
    expect(await status()).toContain("Guide — changes aren't saved");
  });

  it("shows no spelling or grammar marks", async () => {
    await settle(browser);
    const marks = await browser.execute(() =>
      (window.__bismillah?.diagnostics() ?? []).filter((d) => d.drawn),
    );
    expect(marks).toEqual([]);
  });

  it("takes edits but never saves them, and opens afresh", async () => {
    await typeAtEnd(" Tried.");
    expect(await text()).toBe(`${guide} Tried.`);
    expect(await browser.execute(() => window.__bismillah?.saveState()?.state.kind)).toBe("sample");
    await browser.execute(() => window.__bismillah?.run("app.guide"));
    await browser.waitUntil(async () => (await text()) === guide, { timeout: 5000 });
  });

  it("is in the palette as Guide, with its shortcut", async () => {
    await browser.execute(() => window.__bismillah?.run("app.commandPalette"));
    await browser.keys([..."manual"]);
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => window.__bismillah?.picker()?.items ?? [])).some((item) =>
          item.startsWith("Guide"),
        ),
      { timeout: 3000, timeoutMsg: "the palette doesn't find Guide by an alias" },
    );
    const items = await browser.execute(() => window.__bismillah?.picker()?.items ?? []);
    expect(items.find((item) => item.startsWith("Guide"))).toContain("F1");
    await browser.keys(["Escape"]);
  });

  it("keeps its own words to itself: a writer's file is checked as always", async () => {
    await open(folder.file("zuhd.md", "Zuhd mode is restraint.\n"));
    await settle(browser);
    const marked = await browser.execute(() =>
      (window.__bismillah?.diagnostics() ?? []).filter((d) => d.drawn).map((d) => d.text),
    );
    expect(marked).toContain("Zuhd");
    expect(await browser.getTitle()).toBe("zuhd.md — bismillah");
  });
});
