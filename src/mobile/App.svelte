<script lang="ts">
  import { onBackButtonPress } from "@tauri-apps/api/app";
  import { invoke } from "@tauri-apps/api/core";
  import type { PluginListener } from "@tauri-apps/api/core";
  import { Dialog } from "bits-ui";
  import { onMount } from "svelte";
  import specimen from "../../docs/specimen.md?raw";
  import { loadFonts, setProfile, setTheme, type Profile, type Theme } from "../core/appearance.ts";
  import { createEditor, type Editor } from "../editor/setup.ts";
  import { remeasure } from "../editor/typography.ts";
  import {
    arrivedAs,
    exact,
    nameParts,
    receiving,
    refused,
    runStanding,
    type Frame,
    type RunProgress,
  } from "./receiving.ts";
  import { arrived, arrivedAt, matching, next, pathParts, SECTIONS, type Row } from "./sheet.ts";

  type Step = "small" | "medium" | "large";
  interface Settings {
    theme: Theme;
    profile: Exclude<Profile, "custom">;
    size: Step;
    margins: Step;
  }
  interface Version {
    digest: string;
    bytes: number;
    received_ms: number | null;
  }
  interface TextDocument {
    name: string | null;
    selection: boolean;
    versions: Version[];
  }
  interface Opened {
    text: string;
    bytes: number;
    exact: boolean;
  }

  const THEMES: readonly Settings["theme"][] = ["system", "light", "dark"];
  const PROFILES: readonly Settings["profile"][] = ["duo", "serif", "plex-arabic", "amiri"];
  const STEPS: readonly Step[] = ["small", "medium", "large"];
  const PROFILE_NAMES: Record<Settings["profile"], string> = {
    duo: "Duo",
    serif: "Serif",
    "plex-arabic": "Plex Arabic",
    amiri: "Amiri",
  };
  const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const UNNAMED = "Unnamed text";

  let page = $state<HTMLElement>();
  let editor: Editor | null = null;
  let documents = $state.raw<TextDocument[]>([]);
  /** What's on the page, or nothing for the sample. */
  let reading = $state.raw<{ name: string | null; selection: boolean; digest: string } | null>(
    null,
  );
  /** How the last run stands, for the sheet: it outlives a restart. */
  let latestRun = $state.raw<RunProgress | null>(null);
  /** The run coming in right now, for the quiet line. */
  let liveRun: RunProgress | null = null;
  let settings = $state.raw<Settings>({
    theme: "system",
    profile: "duo",
    size: "medium",
    margins: "medium",
  });
  let sheetOpen = $state(false);
  /** The key to type into the stick, while it's on the screen. */
  let pairing = $state.raw<{ key: string; words: string } | null>(null);
  let query = $state("");

  // The quiet line: a name in any script, isolated, and what's known about it.
  let line = $state<{
    before: string;
    stem: string;
    after: string;
    warning: boolean;
  }>({ before: "", stem: "", after: "", warning: false });

  /** Bumped by anything said on the quiet line, so that a slow opening, as at start-up,
   * can't overwrite something newer: a print's arrival above all. */
  let said = 0;
  /** Which opening of a text is current, so a slower one can't replace a newer page. */
  let opening = 0;

  function say(text: string, warning = false): void {
    said++;
    line = { before: text, stem: "", after: "", warning };
  }

  function sayText(name: string, selection: boolean, state: string, warning = false): void {
    const { stem, ending } = nameParts(name);
    said++;
    line = {
      before: selection ? "Part of " : "",
      stem,
      after: `${ending}. ${state}`,
      warning,
    };
  }

  function show(text: string, label: string): void {
    if (!page) return;
    editor?.view.destroy();
    const shown = createEditor({
      parent: page,
      doc: text,
      readOnly: true,
      steadyCaret: true,
      label,
      config: { typewriter: false, spelling: false, grammar: false, formatBar: false },
    });
    // A reading view has no caret to reveal Markdown at: the heading it would open on
    // has no gutter here to hang its marks in.
    shown.view.dispatch({ selection: { anchor: shown.view.state.doc.length } });
    // Hanging marks are measured in the document's fonts, which arrive after layout.
    void document.fonts.ready.then(() => {
      remeasure(shown.view);
    });
    editor = shown;
  }

  async function refresh(): Promise<void> {
    try {
      documents = await invoke<TextDocument[]>("documents");
    } catch {
      say("The texts on this phone can't be read just now.", true);
    }
  }

  function showSample(): void {
    reading = null;
    show(specimen, "specimen.md");
    say("A sample. Nothing has been received yet.");
  }

  async function openText(doc: TextDocument, version: Version): Promise<void> {
    const name = doc.name ?? UNNAMED;
    const earlier = doc.versions[0]?.digest !== version.digest;
    const mine = ++opening;
    const before = said;
    try {
      const opened = await invoke<Opened>("document_open", { id: version.digest });
      if (mine !== opening) return;
      show(opened.text, name);
      reading = { name: doc.name, selection: doc.selection, digest: version.digest };
      if (said !== before) return;
      if (opened.exact) {
        const when = earlier ? `An earlier version, from ${arrived(version.received_ms)}. ` : "";
        sayText(name, doc.selection, `${when}${exact(opened.bytes)}`);
      } else {
        sayText(
          name,
          doc.selection,
          "This copy has changed since it arrived. Print it again for an exact one.",
          true,
        );
      }
    } catch {
      if (mine === opening && said === before)
        say("This text can't be read just now. Nothing has been changed.", true);
    }
  }

  async function openLatest(doc: TextDocument): Promise<void> {
    const latest = doc.versions[0];
    if (latest) await openText(doc, latest);
  }

  function apply(chosen: Settings): void {
    setTheme(chosen.theme);
    setProfile(chosen.profile);
    paintBars();
    const root = document.documentElement;
    root.dataset.phoneSize = chosen.size;
    root.dataset.phoneMargins = chosen.margins;
    void loadFonts(chosen.profile).then(() => {
      if (editor) remeasure(editor.view);
    });
  }

  async function change(patch: Partial<Settings>): Promise<void> {
    settings = { ...settings, ...patch };
    apply(settings);
    try {
      await invoke("settings_set", { settings });
    } catch {
      say("That setting applies for now, but it couldn't be saved.", true);
    }
  }

  /** One text of a run came in. The page stays as it is, so nothing moves under a writer
   * reading it, unless all it holds is the sample. */
  async function runArrived(run: RunProgress): Promise<void> {
    liveRun = run;
    latestRun = run;
    await refresh();
    const first = documents[0];
    if (reading === null && first) await openLatest(first);
    say(runStanding(run));
  }

  /** One QR code's text. What it did is on the quiet line; a stray changes nothing. */
  async function receiveFrame(text: string): Promise<Frame | { state: "refused" }> {
    try {
      const frame = await invoke<Frame>("receive_frame", { text });
      if (frame.state === "receiving") {
        const progress = receiving(frame.resolved, frame.total);
        say(liveRun ? `${runStanding(liveRun)} ${progress}.` : progress);
      }
      if (frame.state === "stored") {
        if (frame.run) {
          await runArrived(frame.run);
        } else {
          liveRun = null;
          // A still code completes on every frame, and the page mustn't rebuild each time.
          opening++;
          if (frame.text !== null && reading?.digest !== frame.digest) show(frame.text, frame.name);
          reading = { name: frame.name, selection: frame.selection, digest: frame.digest };
          sayText(frame.name, frame.selection, arrivedAs(frame.bytes, frame.sealed));
          await refresh();
        }
      }
      return frame;
    } catch (error) {
      say(refused(error), true);
      return { state: "refused" };
    }
  }

  async function showPairing(): Promise<void> {
    try {
      pairing = await invoke<{ key: string; words: string }>("phone_key");
    } catch {
      say("This phone's key can't be read just now. Nothing has been changed.", true);
    }
  }

  /** The open text's versions, when there's more than the one. */
  const versions = $derived.by<Version[]>(() => {
    const open = reading;
    if (!open || open.selection) return [];
    const doc = documents.find((d) => d.name === open.name && !d.selection);
    return doc && doc.versions.length > 1 ? doc.versions : [];
  });

  function documentOf(version: Version): TextDocument | undefined {
    return documents.find(
      (d) => d.name === reading?.name && !d.selection && d.versions.includes(version),
    );
  }

  const documentId = (doc: TextDocument) =>
    `${doc.selection ? "part" : "whole"}:${doc.name ?? ""}:${doc.versions[0]?.digest ?? ""}`;

  const rows = $derived.by<Row[]>(() => [
    ...documents.map((doc): Row => ({
      id: documentId(doc),
      section: "Texts",
      label: doc.name ?? UNNAMED,
      run: () => openLatest(doc),
    })),
    ...versions.map((version, index): Row => ({
      id: `version:${version.digest}`,
      section: "Versions",
      label: `${arrivedAt(version.received_ms)}${index === 0 ? ", latest" : ""}`,
      run: () => {
        const doc = documentOf(version);
        return doc ? openText(doc, version) : undefined;
      },
    })),
    ...(latestRun && latestRun.have < latestRun.count
      ? [
          {
            id: "run",
            section: "Commands",
            label: `Library print: ${latestRun.have} of ${latestRun.count} texts`,
            run: () => {
              if (latestRun) say(runStanding(latestRun));
            },
          } satisfies Row,
        ]
      : []),
    {
      id: "pair",
      section: "Commands",
      label: "Pair with a stick",
      run: showPairing,
    },
    {
      id: "sample",
      section: "Commands",
      label: "Show the sample",
      run: showSample,
    },
    {
      id: "theme",
      section: "Settings",
      label: `Theme: ${capital(settings.theme)}`,
      run: () => change({ theme: next(THEMES, settings.theme) }),
    },
    {
      id: "font",
      section: "Settings",
      label: `Font: ${PROFILE_NAMES[settings.profile]}`,
      run: () => change({ profile: next(PROFILES, settings.profile) }),
    },
    {
      id: "size",
      section: "Settings",
      label: `Text size: ${capital(settings.size)}`,
      run: () => change({ size: next(STEPS, settings.size) }),
    },
    {
      id: "margins",
      section: "Settings",
      label: `Margins: ${capital(settings.margins)}`,
      run: () => change({ margins: next(STEPS, settings.margins) }),
    },
  ]);

  const shown = $derived(matching(rows, query));
  const sections = $derived(
    SECTIONS.map((section) => ({
      section,
      rows: shown.filter((row) => row.section === section),
    })).filter((group) => group.rows.length > 0),
  );

  /** Opening a text or running a command closes the sheet; a setting stays to be seen. */
  async function choose(row: Row): Promise<void> {
    if (row.section !== "Settings") sheetOpen = false;
    await row.run();
  }

  function documentOfRow(row: Row): TextDocument | undefined {
    return row.section === "Texts" ? documents.find((d) => documentId(d) === row.id) : undefined;
  }

  /** What's quiet beside a text in the list: its folder, and what else is known. */
  function textDetail(doc: TextDocument | undefined): string {
    const count = doc?.versions.length ?? 0;
    return [
      doc?.selection ? "Part" : "",
      count > 1 ? `${count} versions` : "",
      arrived(doc?.versions[0]?.received_ms ?? null),
    ]
      .filter(Boolean)
      .join(" · ");
  }

  /** The bars follow the page: Android knows only the system's theme by itself. */
  function paintBars(): void {
    const dark =
      settings.theme === "dark" ||
      (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    (window as { bismillahBars?: { set(dark: boolean): void } }).bismillahBars?.set(dark);
  }

  // While the sheet is open, the back gesture closes it. Otherwise it leaves the app, as
  // anywhere else on the phone.
  let backListener: Promise<PluginListener> | null = null;
  $effect(() => {
    if (sheetOpen) query = "";
  });
  $effect(() => {
    if (!sheetOpen && pairing === null) return;
    backListener = onBackButtonPress(() => {
      sheetOpen = false;
      pairing = null;
    });
    return () => {
      void backListener?.then((listener) => listener.unregister());
      backListener = null;
    };
  });

  onMount(() => {
    void (async () => {
      settings = await invoke<Settings>("settings_get").catch(() => settings);
      apply(settings);
      await refresh();
      latestRun = await invoke<RunProgress | null>("run_latest").catch(() => null);
      // A print may have arrived meanwhile, and its page and words stay.
      if (editor) return;
      const newest = documents[0];
      if (newest) await openLatest(newest);
      else if (said === 0) showSample();
      else show(specimen, "specimen.md");
    })();

    const system = window.matchMedia("(prefers-color-scheme: dark)");
    system.addEventListener("change", paintBars);

    // The way in until the camera exists. Debug builds only: tests/mobile/receive.ts.
    if (import.meta.env.TAURI_ENV_DEBUG === "true") {
      Object.assign(window, {
        bismillahTest: {
          receiveFrame,
          status: () => document.getElementById("status")?.textContent?.trim() ?? "",
          shown: () => editor?.view.state.doc.toString() ?? "",
          documents: () => invoke<TextDocument[]>("documents"),
          settings: () => settings,
          openSheet: () => (sheetOpen = true),
          closeSheet: () => (sheetOpen = false),
          phoneKey: () => invoke<{ key: string; words: string }>("phone_key"),
          closePairing: () => (pairing = null),
        },
      });
    }
    return () => {
      system.removeEventListener("change", paintBars);
    };
  });
</script>

<div id="page" bind:this={page}></div>

<footer class="quiet">
  <button type="button" class="search" onclick={() => (sheetOpen = true)}>Search</button>
  <p id="status" role="status" class:warning={line.warning}>
    {line.before}{#if line.stem}<bdi>{line.stem}</bdi>{/if}{line.after}
  </p>
</footer>

<Dialog.Root
  open={pairing !== null}
  onOpenChange={(open) => {
    if (!open) pairing = null;
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="sheet-scrim" />
    <Dialog.Content class="sheet pairing" aria-describedby="pairing-how">
      <div class="field">
        <Dialog.Title class="pairing-title">Pair with a stick</Dialog.Title>
        <Dialog.Close class="close">Close</Dialog.Close>
      </div>
      {#if pairing}
        <p id="pairing-how">
          On the stick, choose Pair with phone and type this key. You only do it once.
        </p>
        <p class="key" dir="ltr">{pairing.key}</p>
        <p>
          The stick then shows these four words. If they match, only this phone can read what it
          prints.
        </p>
        <p class="words" dir="ltr">{pairing.words}</p>
      {/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<Dialog.Root bind:open={sheetOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="sheet-scrim" />
    <Dialog.Content
      class="sheet"
      onOpenAutoFocus={(event) => {
        // The keyboard comes up only when the writer taps the field.
        event.preventDefault();
      }}
    >
      <Dialog.Title class="visually-hidden">Search</Dialog.Title>
      <div class="field">
        <input
          type="search"
          dir="auto"
          placeholder="Search"
          aria-label="Search texts, commands and settings"
          bind:value={query}
        />
        <Dialog.Close class="close">Close</Dialog.Close>
      </div>
      <div class="list">
        {#each sections as group (group.section)}
          <h2>{group.section}</h2>
          <ul>
            {#each group.rows as row (row.id)}
              {@const doc = documentOfRow(row)}
              {@const here = row.section === "Versions" && row.id === `version:${reading?.digest}`}
              <li>
                <button
                  type="button"
                  aria-current={here ? "true" : undefined}
                  onclick={() => choose(row)}
                >
                  {#if group.section === "Texts"}
                    {@const path = pathParts(row.label)}
                    {@const parts = nameParts(path.file)}
                    <span class="label">
                      {#if path.folder}<bdi class="folder">{path.folder}</bdi>{/if}
                      <span><bdi>{parts.stem}</bdi>{parts.ending}</span>
                    </span>
                    <span class="detail">{textDetail(doc)}</span>
                  {:else}
                    <span class="label">{row.label}</span>
                    {#if here}<span class="detail">Showing</span>{/if}
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="nothing">Nothing matches.</p>
        {/each}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
