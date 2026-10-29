import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { browser, expect } from "@wdio/globals";
import { waitForApp } from "../app.ts";
import { REPO } from "../driver.ts";

describe("the app", () => {
  before(async () => {
    await waitForApp(browser);
  });

  it("opens the specimen exactly as it is on disk", async () => {
    const text = await browser.execute(() => window.__bismillah?.view.state.doc.toString());
    expect(text).toBe(readFileSync(resolve(REPO, "docs/specimen.md"), "utf8"));
  });

  it("shows the Basmallah above the document without adding it to the text", async () => {
    const [shown, inDoc] = await browser.execute(() => {
      const el = document.querySelector(".cm-basmallah");
      const view = window.__bismillah?.view;
      return [el?.textContent ?? null, view?.state.doc.toString().startsWith("بِسْمِ") ?? null];
    });
    expect(shown).toBe("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ");
    expect(inDoc).toBe(false);
  });

  it("loads with no content-security-policy violations", async () => {
    const violations = await browser.execute(() => window.__cspViolations ?? []);
    expect(violations).toEqual([]);
  });

  it("offers the page no sound, media, speech, microphone, real-time connections or WebGL", async () => {
    const offered = await browser.execute(() => ({
      webAudio: typeof AudioContext !== "undefined",
      // With media off, <audio> and <video> are inert unknown elements.
      media: document.createElement("audio") instanceof HTMLMediaElement,
      speech: typeof speechSynthesis !== "undefined",
      microphone: typeof navigator.mediaDevices !== "undefined",
      webrtc: typeof RTCPeerConnection !== "undefined",
      webgl: document.createElement("canvas").getContext("webgl") !== null,
    }));
    expect(offered).toEqual({
      webAudio: false,
      media: false,
      speech: false,
      microphone: false,
      webrtc: false,
      webgl: false,
    });
  });

  it("names the document in the window title", async () => {
    expect(await browser.getTitle()).toBe("specimen.md — bismillah");
  });
});
