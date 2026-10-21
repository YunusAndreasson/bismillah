import { browser, expect } from "@wdio/globals";
import { mkdirSync, readFileSync } from "node:fs";
import { waitForApp, settle, setViewport } from "../app.ts";
import { docText, flush, Folder, open } from "./files.ts";

const selection = () =>
  browser.execute(() => {
    const v = window.__bismillah?.view;
    if (!v) return null;
    const s = v.state.selection.main;
    return { from: s.from, to: s.to, text: v.state.sliceDoc(s.from, s.to) };
  });

async function query(text: string, replacement = ""): Promise<void> {
  await browser.execute(
    (find: string, replace: string) => {
      window.__bismillah?.run("edit.find");
      for (const [name, value] of [
        ["search", find],
        ["replace", replace],
      ]) {
        const field = document.querySelector<HTMLInputElement>(`.cm-search [name="${name}"]`);
        if (field && value !== undefined) {
          field.value = value;
          field.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    },
    text,
    replacement,
  );
}

describe("document search and navigation", () => {
  let folder: Folder;
  before(async () => {
    await waitForApp(browser);
    folder = new Folder();
  });
  after(() => folder.remove());

  it("opens by keyboard, wraps matches and closes before putting the pen down", async () => {
    await open(folder.file("find.md", "One two One\n"));
    await browser.execute(() => window.__bismillah?.view.focus());
    await browser.keys(["Control", "f"]);
    await browser.$('.cm-search [name="search"]').waitForDisplayed();
    expect(await browser.$('.cm-search [name="select"]').isDisplayed()).toBe(false);
    await browser.keys("One");
    await browser.keys("Enter");
    expect((await selection())?.from).toBe(0);
    await browser.keys("F3");
    expect((await selection())?.from).toBe(8);
    await browser.keys("F3");
    expect((await selection())?.from).toBe(0);
    await browser.keys(["Shift", "F3"]);
    expect((await selection())?.from).toBe(8);
    await browser.keys("Escape");
    expect(await browser.$(".cm-search").isExisting()).toBe(false);
    expect(
      await browser.execute(() => ({
        focused: document.activeElement?.classList.contains("cm-content"),
        resting: document.querySelector(".cm-resting") !== null,
      })),
    ).toEqual({ focused: true, resting: false });
    expect(await docText()).toBe("One two One\n");
    await browser.keys(["Control", "h"]);
    expect(await browser.execute(() => document.activeElement?.getAttribute("name"))).toBe(
      "replace",
    );
    await browser.keys("Escape");
  });

  it("finds vocalised Arabic without dropping marks and replaces only explicit matches", async () => {
    const original = "---\ntitle: بِسْمِ\n---\n\nبِسْمِ بسم بِسْمِ\nLatin é e\u0301.\n";
    await open(folder.file("arabic.md", original));
    await query("بِسْمِ", "بِاسْمِ");
    await browser.$('.cm-search [name="next"]').click();
    expect((await selection())?.text).toBe("بِسْمِ");
    await browser.$('.cm-search [name="replaceAll"]').click();
    expect(await docText()).toBe(original.replaceAll("بِسْمِ", "بِاسْمِ"));
    await browser.keys("Escape");
    await browser.keys(["Control", "z"]);
    expect(await docText()).toBe(original);
    expect(await flush()).toBe(true);
    expect(folder.read("arabic.md").toString()).toBe(original);
  });

  it("keeps original Unicode bytes until replacement, and undoes replace-all as one edit", async () => {
    const original = "é e\u0301 ﬀ ff\nبِسْمِ اللَّهِ\n";
    await open(folder.file("unicode.md", original));
    await query("é", "E");
    expect(await docText()).toBe(original);
    await browser.$('.cm-search [name="replaceAll"]').click();
    expect(await docText()).toBe("E E ﬀ ff\nبِسْمِ اللَّهِ\n");
    await browser.keys("Escape");
    await browser.keys(["Control", "z"]);
    expect(await docText()).toBe(original);
  });

  it("supports case, whole-word, invalid regex and capture replacement", async () => {
    await open(folder.file("options.md", "Cat cat scatter\nitem-12 item-34\n"));
    await query("cat", "dog");
    await browser.$('.cm-search [name="case"]').click();
    await browser.$('.cm-search [name="word"]').click();
    await browser.$('.cm-search [name="replaceAll"]').click();
    expect(await docText()).toBe("Cat dog scatter\nitem-12 item-34\n");
    await browser.$('.cm-search [name="word"]').click();
    await browser.$('.cm-search [name="re"]').click();
    await query("[", "oops");
    await browser.$('.cm-search [name="replaceAll"]').click();
    expect(await docText()).toBe("Cat dog scatter\nitem-12 item-34\n");
    await query("item-(\\d+)", "$1");
    await browser.$('.cm-search [name="replaceAll"]').click();
    expect(await docText()).toBe("Cat dog scatter\n12 34\n");
    await browser.keys("Escape");
  });

  it("jumps to lines, relative offsets, columns and percentages without edits", async () => {
    const text = Array.from({ length: 100 }, (_, i) => `${i + 1}: بِسْمِ mixed`).join("\n");
    await open(folder.file("lines.md", text));
    for (const [input, line, column] of [
      ["12:4", 12, 4],
      ["+10", 22, 0],
      ["-2", 20, 0],
      ["50%", 50, 0],
    ] as const) {
      await browser.execute(() => window.__bismillah?.run("edit.goToLine"));
      await browser.$(".cm-goto-line input").setValue(input);
      await browser.keys("Enter");
      await browser.waitUntil(async () => !(await browser.$(".cm-goto-line").isExisting()));
      expect(
        await browser.execute(() => {
          const v = window.__bismillah?.view;
          if (!v) return null;
          const at = v.state.selection.main.head;
          const l = v.state.doc.lineAt(at);
          return [l.number, at - l.from];
        }),
      ).toEqual([line, column]);
    }
    expect(await docText()).toBe(text);
  });

  it("keeps document commands disabled when no document is open", async () => {
    await browser.execute(() => window.__bismillah?.welcome());
    for (const id of ["edit.find", "edit.replace", "edit.goToLine"] as const) {
      await browser.waitUntil(
        async () =>
          (await browser.execute(
            async (command: typeof id) => await window.__bismillah?.menuItemEnabled(command),
            id,
          )) === false,
      );
    }
    await open(folder.file("reopen.md", "Text"));
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          async () => await window.__bismillah?.menuItemEnabled("edit.find"),
        )) === true,
    );
  });

  it("offers find but no replacement in a read-only file", async () => {
    const bytes = Buffer.concat([Buffer.from("Read only بِسْمِ\n"), Buffer.from([0xe9])]);
    const path = folder.file("readonly.md", bytes);
    await open(path);
    await query("بِسْمِ");
    expect(await browser.$('.cm-search input[name="replace"]').isExisting()).toBe(false);
    expect(
      await browser.execute(async () => await window.__bismillah?.menuItemEnabled("edit.replace")),
    ).toBe(false);
    await browser.$('.cm-search [name="next"]').click();
    expect((await selection())?.text).toBe("بِسْمِ");
    await browser.keys("Escape");
    expect(await docText()).toBe("Read only بِسْمِ\n�");
    expect(folder.read("readonly.md").equals(bytes)).toBe(true);
  });

  it("does not reapply settings when the document or library changes", async () => {
    await browser.execute(() => {
      document.documentElement.dataset.profileMutations = "0";
      const observer = new MutationObserver((records) => {
        const root = document.documentElement;
        observer.disconnect();
        root.dataset.profileMutations = String(
          Number(root.dataset.profileMutations) + records.length,
        );
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-profile"],
      });
    });
    await open(folder.file("different.md", "Another document"));
    await browser.execute(
      async (path: string) => window.__bismillah?.setLibrary(path),
      folder.path,
    );
    await settle(browser);
    expect(await browser.execute(() => document.documentElement.dataset.profileMutations)).toBe(
      "0",
    );
    // An actual setting still crosses the bridge.
    await browser.execute(async () =>
      window.__bismillah?.changeSettings({ writing_profile: "serif" }),
    );
    await browser.waitUntil(() =>
      browser.execute(() => document.documentElement.dataset.profile === "serif"),
    );
    await browser.execute(async () =>
      window.__bismillah?.changeSettings({ writing_profile: "duo" }),
    );
  });

  it("keeps panels within the specimen window in both themes and enlarged text", async () => {
    await open(folder.file("specimen.md", readFileSync("docs/specimen.md", "utf8")));
    mkdirSync("/tmp/bismillah-search-review", { recursive: true });
    for (const theme of ["light", "dark"] as const) {
      await browser.execute((t: typeof theme) => window.__bismillah?.setTheme(t), theme);
      for (const width of [640, 1280, 1920, 2560]) {
        await setViewport(browser, width, 900);
        await query("الْحَمْدُ");
        await browser.$('.cm-search [name="next"]').click();
        expect((await selection())?.text).toBe("الْحَمْدُ");
        await settle(browser);
        expect(
          await browser.execute(() => {
            const panel = document.querySelector(".cm-search");
            return panel ? panel.scrollWidth <= panel.clientWidth : false;
          }),
        ).toBe(true);
        if (width <= 1280)
          await browser.saveScreenshot(`/tmp/bismillah-search-review/${theme}-${width}.png`);
        await browser.keys("Escape");
      }
      await setViewport(browser, 640, 500);
      await browser.execute(async () => window.__bismillah?.setScale(2));
      await query("أمانة");
      await browser.$('.cm-search [name="next"]').click();
      expect((await selection())?.text).toBe("أمانة");
      await settle(browser);
      await browser.saveScreenshot(`/tmp/bismillah-search-review/${theme}-200.png`);
      await browser.keys("Escape");
      await browser.execute(async () => window.__bismillah?.setScale(1));
    }
  });
});
