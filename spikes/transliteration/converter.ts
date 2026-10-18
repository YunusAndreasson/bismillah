// Typing simulator for bismillah's typing aids (Phase 0 spike, DESIGN.md §11.3, ADR-0010).
//
// Keys are fed one at a time, as the editor would see them. After each key, a rule may
// replace only the characters just typed at the caret (never earlier text), and an
// immediate Backspace restores the typed keys. Phase 1 ports this logic into src/editor/.
//
// Text is modelled as a list of units: each unit is what one conversion (or one plain key)
// inserted, together with the keys that produced it. Rules match the raw keys of the most
// recent units, aligned to unit boundaries, so "…" (typed "...") never looks like "." to a
// later rule, while "’" (typed "'") still counts as a typed "'" for the hamza rule "''".

export type RuleKind = "macron" | "dot" | "ayn" | "hamza" | "escape";
export type SmartKind = "quote" | "dash" | "ellipsis";

export interface GuardContext {
  /** Text of the current line before the characters the rule would replace. */
  readonly before: string;
  /** Units the rule would replace, oldest first (the key just typed is not included). */
  readonly replaced: readonly Unit[];
}

export interface Rule {
  /** Keys typed, e.g. ".h". The last character is the key that completes the sequence. */
  readonly pattern: string;
  readonly output: string;
  readonly kind: RuleKind;
  /** Returns false to leave the keys as typed. */
  readonly guard?: (ctx: GuardContext) => boolean;
}

export interface Table {
  readonly name: string;
  readonly rules: readonly Rule[];
}

export interface TypistOptions {
  /** Transliteration table, or null when transliteration mode is off. */
  readonly translit: Table | null;
  readonly smartPunctuation: boolean;
}

export interface Unit {
  readonly raw: string;
  readonly out: string;
  readonly source: "key" | "translit" | "smart" | "restored" | "escape";
  /** Restored and escaped units never take part in a later conversion. */
  readonly sticky: boolean;
  /** Inline Markdown state after this unit. */
  readonly state: InlineState;
}

export interface Conversion {
  readonly kind: "translit" | "smart";
  readonly ruleKind: RuleKind | SmartKind;
  readonly pattern: string;
  readonly output: string;
  /** The keys an immediate Backspace restores. */
  readonly replacedRaw: string;
  /** Index, in keys typed so far, of the key that completed the sequence. */
  readonly keyIndex: number;
  /** The line before the replaced characters, for reports. */
  readonly before: string;
}

interface InlineState {
  readonly code: boolean;
  readonly linkTarget: boolean;
  /** The current whitespace-separated token, for URL detection. */
  readonly token: string;
}

const FRESH: InlineState = { code: false, linkTarget: false, token: "" };
const WHITESPACE = /\s/u;
const LETTER = /\p{L}/u;
const ARABIC = /\p{Script=Arabic}/u;
const OPENING_CONTEXT = /[\s([{“‘«—–*_]/u;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
const URL_TOKEN = /^(?:https?:\/\/|www\.)|:\/\//i;
const TAIL_LIMIT = 64;

export class Typist {
  private readonly rulesByKey = new Map<string, Rule[]>();
  private readonly chunks: string[] = [];
  private tail: Unit[] = [];
  /** State before the first unit in `tail` (after units already moved to `chunks`). */
  private baseState: InlineState = FRESH;
  private line = "";
  /** Last character of `line`, kept so typing never re-reads the whole line. */
  private lineLast = "";
  /** Whether the line so far opens a code fence (only its first characters matter). */
  private fenceLine = false;
  /** Whether the line is indented code: four spaces after a blank line or more indented code. */
  private indentedCodeLine = false;
  private indentedCodeAllowed = true;
  private lineNo = 0;
  private fence: string | null = null;
  private frontmatter = false;
  private keys = 0;
  private last: { unit: Unit; conversion: Conversion } | null = null;

  private readonly opts: TypistOptions;

  constructor(opts: TypistOptions) {
    this.opts = opts;
    const rules = [...(opts.translit?.rules ?? [])].sort(
      (a, b) => b.pattern.length - a.pattern.length,
    );
    for (const rule of rules) {
      const key = lastChar(rule.pattern);
      const list = this.rulesByKey.get(key) ?? [];
      list.push(rule);
      this.rulesByKey.set(key, list);
    }
  }

  /** Types one key (one code point, or "\n"). Returns the conversion it caused, if any. */
  type(key: string): Conversion | null {
    const keyIndex = this.keys++;
    this.last = null;
    if (key === "\n") {
      this.endLine();
      this.push({ raw: key, out: key, source: "key", sticky: true });
      return null;
    }
    if (!this.isExcluded()) {
      const conversion =
        (this.opts.translit && this.tryTranslit(key, keyIndex)) ||
        (this.opts.smartPunctuation && this.trySmart(key, keyIndex)) ||
        null;
      if (conversion) return conversion;
    }
    this.push({ raw: key, out: key, source: "key", sticky: false });
    return null;
  }

  /** Types a whole string, key by key. */
  typeAll(text: string): Conversion[] {
    const conversions: Conversion[] = [];
    for (const key of text) {
      const conversion = this.type(key);
      if (conversion) conversions.push(conversion);
    }
    return conversions;
  }

  /**
   * Backspace. Immediately after a conversion it restores the typed keys literally and
   * returns them; otherwise it deletes the last character and returns null.
   */
  backspace(): string | null {
    const last = this.last;
    this.last = null;
    if (last && this.tail.at(-1) === last.unit) {
      this.pop();
      for (const key of last.conversion.replacedRaw) {
        this.push({ raw: key, out: key, source: "restored", sticky: true });
      }
      return last.conversion.replacedRaw;
    }
    const unit = this.tail.at(-1);
    if (!unit) throw new Error("spike: backspace into committed text is not modelled");
    if (unit.out === "\n") throw new Error("spike: backspace across a line break is not modelled");
    this.pop();
    const remaining = [...unit.out].slice(0, -1).join("");
    if (remaining) this.push({ raw: remaining, out: remaining, source: "restored", sticky: true });
    return null;
  }

  text(): string {
    return this.chunks.join("") + this.tail.map((u) => u.out).join("");
  }

  private tryTranslit(key: string, keyIndex: number): Conversion | null {
    for (const rule of this.rulesByKey.get(key) ?? []) {
      const n = this.align(rule.pattern, key);
      if (n < 0) continue;
      const replaced = this.tail.slice(this.tail.length - n);
      const before = this.lineBefore(n);
      if (rule.guard && !rule.guard({ before, replaced })) continue;
      const source = rule.kind === "escape" ? "escape" : "translit";
      return this.replace(n, rule.pattern, rule.output, source, rule.kind, keyIndex, before);
    }
    return null;
  }

  private trySmart(key: string, keyIndex: number): Conversion | null {
    if (key === ".") {
      const n = this.align("...", key);
      if (n >= 0) return this.replace(n, "...", "…", "smart", "ellipsis", keyIndex, this.lineBefore(n));
    } else if (key === "-") {
      for (const [pattern, output] of [
        ["---", "—"],
        ["--", "–"],
      ] as const) {
        const n = this.align(pattern, key);
        if (n < 0) continue;
        const before = this.lineBefore(n);
        // A dash run on a line of its own is a Markdown rule (or frontmatter, or a setext
        // underline); table delimiter rows stay too.
        if (/[^\s-]/u.test(before) && !/^\s*\|/u.test(before))
          return this.replace(n, pattern, output, "smart", "dash", keyIndex, before);
      }
    } else if (key === '"' || key === "'") {
      const opening = this.lineLast === "" || OPENING_CONTEXT.test(this.lineLast);
      const arabic = lastStrongIsArabic(this.line);
      let output: string;
      if (key === '"') output = arabic ? (opening ? "«" : "»") : opening ? "“" : "”";
      else output = arabic || !opening ? "’" : "‘";
      return this.replace(0, key, output, "smart", "quote", keyIndex, this.line);
    }
    return null;
  }

  /** The current line without the last `n` units. */
  private lineBefore(n: number): string {
    const units = this.tail.slice(this.tail.length - n);
    return this.line.slice(0, this.line.length - units.reduce((sum, u) => sum + u.out.length, 0));
  }

  /**
   * How many recent units, together with `key`, spell exactly `pattern` (aligned to unit
   * boundaries), or -1. Sticky units and line breaks never match.
   */
  private align(pattern: string, key: string): number {
    if (!pattern.endsWith(key)) return -1;
    let rest = pattern.slice(0, pattern.length - key.length);
    let n = 0;
    for (let i = this.tail.length - 1; rest.length > 0; i--) {
      const unit = this.tail[i];
      if (!unit || unit.sticky || !rest.endsWith(unit.raw)) return -1;
      rest = rest.slice(0, rest.length - unit.raw.length);
      n++;
    }
    return n;
  }

  private replace(
    n: number,
    raw: string,
    out: string,
    source: Unit["source"],
    ruleKind: Conversion["ruleKind"],
    keyIndex: number,
    before: string,
  ): Conversion {
    for (let i = 0; i < n; i++) this.pop();
    const unit = this.push({ raw, out, source, sticky: source === "escape" });
    const kind = source === "smart" ? "smart" : "translit";
    const conversion: Conversion = {
      kind,
      ruleKind,
      pattern: raw,
      output: out,
      replacedRaw: raw,
      keyIndex,
      before,
    };
    this.last = { unit, conversion };
    return conversion;
  }

  private push(partial: Omit<Unit, "state">): Unit {
    const literal = partial.source !== "translit" && partial.source !== "smart";
    let { code, linkTarget, token } = this.state();
    for (const ch of partial.out) {
      if (ch === "\n") {
        this.line = "";
        this.lineLast = "";
        this.fenceLine = false;
        this.indentedCodeLine = false;
        ({ code, linkTarget, token } = FRESH);
        continue;
      }
      const prev = this.lineLast;
      this.line += ch;
      this.lineLast = ch;
      if (this.line.length <= 8) this.updateLineHead();
      if (ch === "`" && literal) code = !code;
      if (!code) {
        if (ch === "(" && prev === "]") linkTarget = true;
        else if (linkTarget && (ch === ")" || WHITESPACE.test(ch))) linkTarget = false;
      }
      token = WHITESPACE.test(ch) ? "" : token + ch;
    }
    const unit: Unit = { ...partial, state: { code, linkTarget, token } };
    this.tail.push(unit);
    if (this.tail.length > TAIL_LIMIT) {
      const moved = this.tail.splice(0, TAIL_LIMIT / 2);
      this.chunks.push(moved.map((u) => u.out).join(""));
      this.baseState = moved.at(-1)?.state ?? this.baseState;
    }
    return unit;
  }

  private pop(): void {
    const unit = this.tail.pop();
    if (!unit) throw new Error("spike: cannot replace committed text");
    this.line = this.line.slice(0, this.line.length - unit.out.length);
    this.lineLast = lastChar(this.line);
    if (this.line.length <= 8) this.updateLineHead();
  }

  /** Fence openers and indented code are recognised from the first characters of a line. */
  private updateLineHead(): void {
    this.fenceLine = FENCE_LINE.test(this.line);
    this.indentedCodeLine = this.indentedCodeAllowed && /^(?: {4}|\t)/.test(this.line);
  }

  private state(): InlineState {
    return this.tail.at(-1)?.state ?? this.baseState;
  }

  /** Inline code, fenced code, frontmatter, URLs and link targets are never converted. */
  private isExcluded(): boolean {
    if (this.frontmatter || this.fence !== null || this.fenceLine || this.indentedCodeLine)
      return true;
    const state = this.state();
    if (state.code || state.linkTarget) return true;
    return URL_TOKEN.test(state.token.replace(/^[(<[]+/u, ""));
  }

  private endLine(): void {
    const line = this.line;
    this.indentedCodeAllowed = line.trim() === "" || this.indentedCodeLine;
    if (this.lineNo === 0 && line === "---") {
      this.frontmatter = true;
    } else if (this.frontmatter) {
      if (line === "---" || line === "...") this.frontmatter = false;
    } else {
      const marker = FENCE_LINE.exec(line)?.[1];
      if (marker && this.fence === null) this.fence = marker;
      else if (
        marker &&
        this.fence !== null &&
        marker[0] === this.fence[0] &&
        marker.length >= this.fence.length &&
        line.trim() === marker
      )
        this.fence = null;
    }
    this.lineNo++;
  }
}

function lastChar(s: string): string {
  if (s === "") return "";
  const code = s.charCodeAt(s.length - 1);
  // A trailing low surrogate belongs to a two-unit code point.
  return code >= 0xdc00 && code <= 0xdfff && s.length > 1 ? s.slice(-2) : s.slice(-1);
}

function lastStrongIsArabic(line: string): boolean {
  for (let i = line.length - 1, seen = 0; i >= 0 && seen < 200; i--, seen++) {
    const ch = line[i] ?? "";
    if (LETTER.test(ch)) return ARABIC.test(ch);
  }
  return false;
}

/** True if `ch` is a letter (any script, including ʿ and ʾ). */
export function isLetter(ch: string): boolean {
  return LETTER.test(ch);
}
