// Collision harness for the transliteration spike.
//
//   node harness.ts [--corpus <label>=<file-or-dir> ...] [--max-words <n>] [--groups <a,b>]
//                   [--out <report.md>] [--json <out.json>] [--examples <n>]
//
// Always includes the hand-written fixtures in ./fixtures. Extra corpora are plain-text files
// (Project Gutenberg books are unwrapped into paragraphs; other .txt files are one paragraph
// per line) or Markdown files (typed as whole documents, so block context applies).
//
// For each candidate table, the original text is turned into the keys a writer would type
// under that table (ā → "a=", ḥ → ".h", …), typed key by key into the simulator, and every
// conversion the writer did not intend is counted as a collision and undone with an immediate
// Backspace, as the writer would. Intended sequences that fail to convert are misses. The
// baseline is the same text typed with transliteration off (smart punctuation as configured).

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { Typist, type Conversion, type Table } from "./converter.ts";
import {
  AYN_CANDIDATES,
  DOT_CANDIDATES,
  FINAL,
  HAMZA_CANDIDATES,
  MACRON_CANDIDATES,
  PROPOSAL,
} from "./tables.ts";

interface Doc {
  readonly name: string;
  /** Paragraphs typed independently, or one whole Markdown document. */
  readonly parts: readonly string[];
}

interface Corpus {
  readonly label: string;
  readonly docs: readonly Doc[];
  readonly words: number;
}

interface Example {
  readonly doc: string;
  readonly text: string;
}

interface Result {
  corpus: string;
  table: string;
  smart: boolean;
  words: number;
  hits: number;
  collisions: Record<string, number>;
  misses: Record<string, number>;
  flickers: number;
  mismatchedParts: number;
  collisionExamples: Record<string, Example[]>;
  missExamples: Record<string, Example[]>;
}

const here = new URL(".", import.meta.url).pathname;
const args = process.argv.slice(2);
const corpusArgs: Array<[string, string]> = [];
let jsonOut: string | null = null;
let reportOut: string | null = null;
let maxExamples = 6;
let maxWords = Infinity;
let groups: string[] | null = null;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const value = args[i + 1] ?? "";
  if (arg === "--corpus") {
    const eq = value.indexOf("=");
    corpusArgs.push(eq > 0 ? [value.slice(0, eq), value.slice(eq + 1)] : [basename(value), value]);
    i++;
  } else if (arg === "--json") {
    jsonOut = value;
    i++;
  } else if (arg === "--out") {
    reportOut = value;
    i++;
  } else if (arg === "--max-words") {
    maxWords = Number(value);
    i++;
  } else if (arg === "--groups") {
    groups = value.split(",");
    i++;
  } else if (arg === "--examples") {
    maxExamples = Number(value);
    i++;
  } else {
    throw new Error(`unknown argument ${arg}`);
  }
}

function filesIn(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .filter((f) => [".txt", ".md"].includes(extname(f)))
    .sort()
    .map((f) => join(path, f));
}

/** Keeps whole paragraphs until `maxWords` words (the first part of a long book). */
function capWords(parts: string[]): string[] {
  const kept: string[] = [];
  let words = 0;
  for (const part of parts) {
    if (words >= maxWords) break;
    kept.push(part);
    words += countWords(part);
  }
  return kept;
}

function loadDoc(path: string): Doc {
  const doc = parseDoc(path);
  return doc.parts.length > 1 ? { name: doc.name, parts: capWords([...doc.parts]) } : doc;
}

function parseDoc(path: string): Doc {
  const text = readFileSync(path, "utf8").replace(/\r\n?/g, "\n").normalize("NFC");
  const name = basename(path);
  if (extname(path) === ".md") return { name, parts: [text] };
  const start = /\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\n/.exec(text);
  if (start) {
    const endIndex = text.search(/\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG/);
    const body = text.slice(start.index + start[0].length, endIndex > 0 ? endIndex : undefined);
    const parts = body
      .split(/\n\s*\n/)
      .map((p) => p.split("\n").map((l) => l.trim()).join(" ").replace(/ {2,}/g, " ").trim())
      .filter(Boolean);
    return { name, parts };
  }
  // Plain text such as Wikipedia extracts: one paragraph per line; drop "== Heading ==" lines.
  const parts = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^=+ .* =+$/.test(l));
  return { name, parts };
}

function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function loadCorpus(label: string, path: string): Corpus {
  const docs = filesIn(path).map(loadDoc);
  const words = docs.reduce((sum, d) => sum + d.parts.reduce((s, p) => s + countWords(p), 0), 0);
  return { label, docs, words };
}

/** The keys a writer types for `original` under `table`, and where each intended sequence ends. */
function typedForm(original: string, table: Table): { keys: string[]; intended: Map<number, string> } {
  const patternFor = new Map<string, string>();
  for (const rule of table.rules) {
    if (rule.kind !== "escape" && !patternFor.has(rule.output)) patternFor.set(rule.output, rule.pattern);
  }
  const keys: string[] = [];
  const intended = new Map<number, string>();
  for (const ch of original) {
    const pattern = patternFor.get(ch);
    if (pattern === undefined) {
      keys.push(ch);
      continue;
    }
    keys.push(...pattern);
    intended.set(keys.length - 1, pattern);
  }
  return { keys, intended };
}

const baselineCache = new Map<string, string>();
function baseline(part: string, smart: boolean): string {
  const key = `${smart ? 1 : 0}\u0000${part}`;
  let text = baselineCache.get(key);
  if (text === undefined) {
    const typist = new Typist({ translit: null, smartPunctuation: smart });
    typist.typeAll(part);
    text = typist.text();
    baselineCache.set(key, text);
  }
  return text;
}

function context(before: string, conversion: Conversion, following: string): string {
  const left = before.slice(-28).replace(/\n/g, "⏎");
  return `…${left}⟦${conversion.pattern}→${conversion.output}⟧${following.replace(/\n/g, "⏎")}…`;
}

function addExample(map: Record<string, Example[]>, key: string, example: Example): void {
  const list = (map[key] ??= []);
  if (list.length < maxExamples) list.push(example);
}

function evaluate(corpus: Corpus, table: Table, smart: boolean): Result {
  const result: Result = {
    corpus: corpus.label,
    table: table.name,
    smart,
    words: corpus.words,
    hits: 0,
    collisions: {},
    misses: {},
    flickers: 0,
    mismatchedParts: 0,
    collisionExamples: {},
    missExamples: {},
  };
  const hasEscape = table.rules.some((r) => r.kind === "escape");
  for (const doc of corpus.docs) {
    for (const part of doc.parts) {
      const { keys, intended } = typedForm(part, table);
      const typist = new Typist({ translit: table, smartPunctuation: smart });
      const hit = new Set<number>();
      for (let i = 0; i < keys.length; i++) {
        const conversion = typist.type(keys[i] ?? "");
        if (!conversion || conversion.kind !== "translit") continue;
        if (intended.get(i) === conversion.pattern) {
          hit.add(i);
          continue;
        }
        if (conversion.ruleKind === "escape") continue; // repaired the flicker counted below
        if (hasEscape && conversion.pattern === "`" && keys[i + 1] === "`") {
          result.flickers++;
          continue;
        }
        result.collisions[conversion.pattern] = (result.collisions[conversion.pattern] ?? 0) + 1;
        addExample(result.collisionExamples, conversion.pattern, {
          doc: doc.name,
          text: context(conversion.before, conversion, keys.slice(i + 1, i + 16).join("")),
        });
        typist.backspace(); // the writer undoes the unwanted conversion
      }
      result.hits += hit.size;
      for (const [i, pattern] of intended) {
        if (hit.has(i)) continue;
        result.misses[pattern] = (result.misses[pattern] ?? 0) + 1;
        addExample(result.missExamples, pattern, {
          doc: doc.name,
          text: `…${keys.slice(Math.max(0, i - 30), i + 1).join("")}⟦missed⟧${keys.slice(i + 1, i + 12).join("")}…`.replace(/\n/g, "⏎"),
        });
      }
      if (typist.text() !== baseline(part, smart)) result.mismatchedParts++;
    }
  }
  return result;
}

function total(record: Record<string, number>): number {
  return Object.values(record).reduce((a, b) => a + b, 0);
}

function per100k(n: number, words: number): string {
  return words === 0 ? "–" : ((n * 100_000) / words).toFixed(1);
}

// ---------------------------------------------------------------------------------------------

const corpora: Corpus[] = [
  loadCorpus("fixtures", join(here, "fixtures")),
  ...corpusArgs.map(([label, path]) => loadCorpus(label, path)),
];

const runs: Array<{ group: string; tables: readonly Table[]; smartModes: readonly boolean[] }> = [
  { group: "Macrons", tables: MACRON_CANDIDATES, smartModes: [true] },
  { group: "Dots below", tables: DOT_CANDIDATES, smartModes: [true, false] },
  { group: "ʿayn", tables: AYN_CANDIDATES, smartModes: [true] },
  { group: "Hamza", tables: HAMZA_CANDIDATES, smartModes: [true] },
  { group: "Whole tables", tables: [PROPOSAL, FINAL], smartModes: [true, false] },
];

const results: Result[] = [];
const out: string[] = [];
out.push("# Transliteration collision report\n");
out.push("Corpora:\n");
for (const c of corpora) {
  out.push(`- **${c.label}**: ${c.words.toLocaleString("en")} words — ${c.docs.map((d) => d.name).join(", ")}`);
}
out.push("");
out.push("Collisions = unwanted conversions (each costs the writer one Backspace), per 100k words in brackets. Misses = intended sequences that did not convert. Flickers = a backtick that briefly showed ʿ before the next backtick restored it. Mismatch = paragraphs whose final text differs from typing with transliteration off.\n");

for (const run of runs.filter((r) => !groups || groups.some((g) => r.group.startsWith(g)))) {
  out.push(`## ${run.group}\n`);
  out.push(`| Table | Smart | ${corpora.map((c) => `${c.label} collisions`).join(" | ")} | hits | misses | flickers | mismatch |`);
  out.push(`|---|---|${corpora.map(() => "---:").join("|")}|---:|---:|---:|---:|`);
  for (const table of run.tables) {
    for (const smart of run.smartModes) {
      const rs = corpora.map((c) => evaluate(c, table, smart));
      results.push(...rs);
      const cells = rs.map((r) => `${total(r.collisions)} (${per100k(total(r.collisions), r.words)})`);
      const sum = (f: (r: Result) => number) => rs.reduce((a, r) => a + f(r), 0);
      out.push(
        `| ${table.name} | ${smart ? "on" : "off"} | ${cells.join(" | ")} | ${sum((r) => r.hits)} | ${sum((r) => total(r.misses))} | ${sum((r) => r.flickers)} | ${sum((r) => r.mismatchedParts)} |`,
      );
    }
  }
  out.push("");
  for (const table of run.tables) {
    const rs = results.filter((r) => r.table === table.name);
    const lines: string[] = [];
    for (const r of rs) {
      const smart = r.smart ? "" : " [smart off]";
      for (const [pattern, n] of Object.entries(r.collisions).sort((a, b) => b[1] - a[1])) {
        if (!r.smart && rs.some((o) => o.smart && o.corpus === r.corpus && o.collisions[pattern] === n)) continue;
        const examples = (r.collisionExamples[pattern] ?? []).map((e) => `\`${e.text}\` (${e.doc})`);
        lines.push(`  - ${r.corpus}${smart} \`${pattern}\` ×${n}: ${examples.join("; ")}`);
      }
      for (const [pattern, n] of Object.entries(r.misses)) {
        const examples = (r.missExamples[pattern] ?? []).map((e) => `\`${e.text}\` (${e.doc})`);
        lines.push(`  - ${r.corpus}${smart} MISSED \`${pattern}\` ×${n}: ${examples.join("; ")}`);
      }
    }
    if (lines.length) out.push(`- **${table.name}**`, ...lines);
  }
  out.push("");
}

if (reportOut) writeFileSync(reportOut, out.join("\n"));
else console.log(out.join("\n"));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
