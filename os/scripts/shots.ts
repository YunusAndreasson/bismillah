/**
 * The stick's real screens, for the website (pnpm os:shots): the debug image in a VM
 * with a 2880×1800 screen at 2× (a 1440×900 laptop, sharp on a high-density display),
 * walked by keyboard through setup, writing, Zuhd mode, Arabic, checking, Files, both
 * themes and the lock. The screens are the release image's: the debug image differs
 * only in what it logs and its root command line, which places the documents.
 *
 *   node os/scripts/shots.ts
 *
 * Writes os/out/shots/<name>.png. web/scripts/screens.sh takes the ones the site uses.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { imageFor, root, Vm } from "./vm.ts";
import { here, mark, passphraseAndCreate, PLAIN, sleep } from "./steps.ts";

const out = join(root, "os/out/shots");

/** Her page as the website sets it (web/src/content/her-page.md, the film's own lines),
 * so the screen on her laptop shows the words the visitor has just watched written. */
const herPage = readFileSync(join(root, "web/src/content/her-page.md"), "utf8");

/** The manifesto (../MANIFESTO.md), exactly as written, one file per section in a
 * Manifesto folder, so the library has texts enough for Files to find one by a few
 * letters. Its first section, Attention, shows Zuhd mode, which keeps the paragraph
 * being written in ink: her page's paragraphs are one line each and can't show it. The
 * caret goes into Attention's second paragraph (line 5), after "Text could now be
 * edited,", near the start of a line, so a phone's detail of the screen shows it too. */
const manifesto = readFileSync(join(root, "MANIFESTO.md"), "utf8");
const [title = "", first = "", ...sections] = manifesto.split(/\n(?=## )/);
const attention = `${title}\n${first}`;
const zuhdLine = attention.split("\n")[4] ?? "";
const zuhdAt = `5:${zuhdLine.indexOf(" moved and restructured")}`;

const documents: Record<string, string> = {
  "How will we think.md": `${herPage.trim()}\n`,
  "Manifesto/Attention.md": `${attention.trim()}\n`,
  ...Object.fromEntries(
    sections.map((text) => [
      `Manifesto/${text.slice(3, text.indexOf("\n"))}.md`,
      `${text.trim()}\n`,
    ]),
  ),
  "al-Fatiha.md": [
    "# al-Fātiḥa",
    "",
    "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
    "",
    "*al-ḥamdu li-llāhi rabbi al-ʿālamīn*: praise belongs to God, Lord of the worlds.",
    "",
    "The word كتاب, *kitāb*, means book; its plural is كتب, *kutub*.",
    "",
  ].join("\n"),
  "Draft.md": [
    "# A draft",
    "",
    "This are the sentance I wrote yesterday, before teh light went.",
    "",
  ].join("\n"),
};

async function scale(vm: Vm): Promise<void> {
  await vm.run(
    "export XDG_RUNTIME_DIR=/run/user/1000; for s in /run/user/1000/wayland-[0-9]; do " +
      "WAYLAND_DISPLAY=${s##*/}; export WAYLAND_DISPLAY; for o in $(wlr-randr | awk '/^[^ ]/{print $1}'); do wlr-randr --output \"$o\" --scale 2; done; done",
  );
  await sleep(1500);
  // A page painted before the change keeps its old layout: going 1× and back to 2×
  // makes the webview lay it out again, as at a real 2× screen from the start.
  await vm.run(
    "export XDG_RUNTIME_DIR=/run/user/1000; for s in /run/user/1000/wayland-[0-9]; do " +
      'WAYLAND_DISPLAY=${s##*/}; export WAYLAND_DISPLAY; for o in $(wlr-randr | awk \'/^[^ ]/{print $1}\'); do wlr-randr --output "$o" --scale 1; sleep 1; wlr-randr --output "$o" --scale 2; done; done',
  );
  await sleep(3000);
}

async function shot(vm: Vm, name: string): Promise<void> {
  await vm.settled(30);
  await vm.screen(name);
  console.log(`  ${name}`);
}

async function command(vm: Vm, name: string): Promise<void> {
  await vm.key("ctrl", "shift", "p");
  await sleep(800);
  await vm.type(name);
  await sleep(800);
  await vm.key("ret");
  await sleep(1500);
}

/** Zuhd mode on the manifesto's first section, the caret in its second paragraph. */
async function zuhd(vm: Vm, name: string): Promise<void> {
  await open(vm, "Attention");
  await vm.key("ctrl", "alt", "g");
  await sleep(800);
  await vm.type(zuhdAt);
  await vm.key("ret");
  await sleep(800);
  await vm.key("ctrl", "d");
  // The caret blinks four times after it moves (4.8 s), then rests lit; `settled` can't
  // wait for that, as a blink changes too few pixels to count.
  await sleep(5500);
  await shot(vm, name);
  await vm.key("ctrl", "d");
}

/** Files over her page, finding a text by four letters of its name: "memo", the
 * manifesto's Memory, the one name they lead to ("mem" also runs through
 * Manifesto/….md, so it finds all four sections). */
async function files(vm: Vm, name: string): Promise<void> {
  await open(vm, "How will we think");
  await vm.key("ctrl", "home");
  await vm.key("ctrl", "p");
  await sleep(1500);
  await vm.type("memo");
  await sleep(1500);
  await shot(vm, name);
}

async function open(vm: Vm, name: string): Promise<void> {
  await vm.key("ctrl", "p");
  await sleep(800);
  await vm.type(name);
  await sleep(800);
  await vm.key("ret");
  await sleep(2500);
}

const vm = await Vm.boot({ image: imageFor("debug"), out, debug: true, resolution: [2880, 1800] });
try {
  // Setup: the keyboard, then the passphrase.
  await mark(vm, "page-gate-shown", 240);
  await scale(vm);
  await shot(vm, "setup-keyboard");
  const from = here(vm);
  await vm.run(
    `echo '{"layouts":"us","options":""}' > /run/bismillah/keyboard.pending && systemctl restart bismillah-session`,
  );
  await mark(vm, "page-gate-shown", 60, from);
  await sleep(1000);
  await scale(vm);
  await shot(vm, "setup-passphrase");
  await passphraseAndCreate(vm, (v) => v.type(PLAIN));
  await mark(vm, "helper-ready", 120, from);
  await mark(vm, "page-editable", 60, from);
  await scale(vm);
  await shot(vm, "first-page");

  for (const [name, text] of Object.entries(documents)) {
    const b64 = Buffer.from(text, "utf8").toString("base64");
    await vm.run(
      `mkdir -p "$(dirname '/home/writer/Texts/${name}')" && echo ${b64} | base64 -d > '/home/writer/Texts/${name}' && chown -R writer:writer /home/writer/Texts`,
    );
  }
  await sleep(1500);

  // Writing: her page, the caret on its first line, as the website's begins: the whole
  // page in view (at its end, the editor scrolls the last line up to the typewriter line).
  await open(vm, "How will we think");
  await vm.key("ctrl", "home");
  await shot(vm, "page-dark");
  await zuhd(vm, "zuhd-dark");
  // Pen down: the whole page as it reads.
  await open(vm, "How will we think");
  await vm.key("ctrl", "home");
  await vm.key("esc");
  await sleep(1000);
  await shot(vm, "read-dark");

  await open(vm, "al-Fatiha");
  await vm.key("ctrl", "home");
  await shot(vm, "arabic-dark");

  await open(vm, "Draft");
  await vm.key("ctrl", "end");
  await sleep(4000); // the checking answers
  await shot(vm, "checking-dark");
  await vm.key("shift", "f7");
  await sleep(500);
  await vm.key("ctrl", "dot");
  await sleep(1000);
  await shot(vm, "suggestion-dark");
  await vm.key("esc");
  await sleep(500);

  await files(vm, "files-dark");
  await vm.key("esc");
  await sleep(800);

  // The light theme, the same screens.
  await vm.key("ctrl", "shift", "l");
  await sleep(1500);
  await open(vm, "How will we think");
  await vm.key("ctrl", "home");
  await shot(vm, "page-light");
  await zuhd(vm, "zuhd-light");
  await open(vm, "al-Fatiha");
  await vm.key("ctrl", "home");
  await shot(vm, "arabic-light");
  await open(vm, "Draft");
  await vm.key("ctrl", "end");
  await sleep(4000);
  await vm.key("shift", "f7");
  await sleep(500);
  await vm.key("ctrl", "dot");
  await sleep(1000);
  await shot(vm, "suggestion-light");
  await vm.key("esc");
  await files(vm, "files-light");
  await vm.key("esc");
  await sleep(800);

  await command(vm, "lock");
  await shot(vm, "lock-light");
} finally {
  vm.kill();
  vm.pngs();
}
