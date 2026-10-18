import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser } from "@wdio/globals";
import type { SaveState } from "../../src/core/session.svelte.ts";

/** Helpers for the file-safety suites: real files in a scratch folder, opened in the app. */

export class Folder {
  readonly path = mkdtempSync(join(tmpdir(), "bismillah-e2e-"));

  file(name: string, content: string | Uint8Array): string {
    const path = join(this.path, name);
    writeFileSync(path, content);
    return path;
  }

  read(name: string): Buffer {
    return readFileSync(join(this.path, name));
  }

  lock(): void {
    chmodSync(this.path, 0o555);
  }

  unlock(): void {
    chmodSync(this.path, 0o755);
  }

  remove(): void {
    this.unlock();
    rmSync(this.path, { recursive: true, force: true });
  }
}

export async function open(path: string): Promise<void> {
  await browser.execute(async (p: string) => {
    await window.__bismillah?.open(p);
  }, path);
}

/** Types at the end of the document, as the writer would. */
export async function typeAtEnd(text: string): Promise<void> {
  await browser.execute(() => {
    const view = window.__bismillah?.view;
    view?.focus();
    view?.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  // One key per call: WebKitWebDriver drops the second of two identical keys sent
  // together ("ee" arrives as "e").
  for (const key of text) await browser.keys(key);
}

export async function flush(): Promise<boolean> {
  return browser.execute(async () => (await window.__bismillah?.flush()) ?? false);
}

export async function saveState(): Promise<SaveState["kind"] | null> {
  return browser.execute(() => window.__bismillah?.saveState()?.state.kind ?? null);
}

export async function saveError(): Promise<string | null> {
  return browser.execute(() => {
    const state = window.__bismillah?.saveState()?.state;
    return state?.kind === "failed" ? state.error.kind : null;
  });
}

export async function notices(): Promise<{ message: string; actions: string[] }[]> {
  return browser.execute(() => window.__bismillah?.notices() ?? []);
}

export async function act(label: string): Promise<void> {
  await browser.execute(async (l: string) => {
    await window.__bismillah?.act(l);
  }, label);
}

export async function docText(): Promise<string> {
  return browser.execute(() => window.__bismillah?.view.state.doc.toString() ?? "");
}

export async function statusText(): Promise<string> {
  return browser.execute(() => window.__bismillah?.status() ?? "");
}

export async function fault(kind: "disk_full" | "rename_fails" | null): Promise<void> {
  await browser.execute(async (k: "disk_full" | "rename_fails" | null) => {
    await window.__bismillah?.fault(k);
  }, kind);
}

/** The recovery journal of the app under test (headless.sh gives it a private data dir). */
export function recoveryTexts(): string[] {
  const dir = join(process.env.XDG_DATA_HOME ?? "", "bismillah", "recovery");
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => readFileSync(join(dir, n), "utf8"));
  } catch {
    return [];
  }
}

export async function waitForState(kind: SaveState["kind"]): Promise<void> {
  await browser.waitUntil(async () => (await saveState()) === kind, {
    timeout: 5000,
    timeoutMsg: `the save state never became ${kind}`,
  });
}
