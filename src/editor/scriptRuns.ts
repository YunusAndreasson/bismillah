import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * Arabic script runs get `lang="ar"` and the profile's Arabic font, so a run is shaped
 * by one font from end to end, including the spaces between its words (DESIGN.md §8.2).
 * A run that contains Qur'anic annotation marks is set in Amiri Quran as a whole, never
 * character by character. The trigger is alef wasla (U+0671) or an annotation mark
 * (U+06D6–U+06ED, U+08D3–U+08FF); see docs/spikes/glyphs.md.
 *
 * Vocalised runs (harakat, shadda, sukun, superscript alef) are marked too: stacked marks
 * need more line room than the Latin line height gives in some profiles, so CSS can give
 * just those runs a taller inline box (docs/spikes/font-profiles.md).
 */

const ARABIC = "\\u0600-\\u06FF\\u0750-\\u077F\\u0870-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
const RUN = new RegExp(
  `[${ARABIC}][${ARABIC}\\p{M}\\u200C\\u200D]*(?:[ \\u00A0]+[${ARABIC}][${ARABIC}\\p{M}\\u200C\\u200D]*)*`,
  "gu",
);
const QURANIC = /\u0671|[\u06D6-\u06ED]|[\u08D3-\u08FF]/u;
const VOCALISED = /[\u064B-\u0652\u0670]/u;
const SKIP = new Set(["FencedCode", "CodeBlock", "InlineCode", "Frontmatter", "URL", "Autolink"]);

export interface ScriptRun {
  from: number;
  to: number;
  quranic: boolean;
  vocalised: boolean;
}

/** Arabic runs in `text`, with offsets relative to it (UTF-16 code units). */
export function arabicRuns(text: string): ScriptRun[] {
  const runs: ScriptRun[] = [];
  for (const match of text.matchAll(RUN)) {
    runs.push({
      from: match.index,
      to: match.index + match[0].length,
      quranic: QURANIC.test(match[0]),
      vocalised: VOCALISED.test(match[0]),
    });
  }
  return runs;
}

const deco = (cls: string) => Decoration.mark({ class: cls, attributes: { lang: "ar" } });
const decos = {
  plain: deco("cm-ar"),
  vocalised: deco("cm-ar cm-ar-voc"),
  quran: deco("cm-ar cm-quran"),
};

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      for (const run of arabicRuns(line.text)) {
        const start = line.from + run.from;
        let skip = false;
        for (let node = tree.resolveInner(start, 1); node.parent; node = node.parent) {
          if (SKIP.has(node.name)) skip = true;
        }
        const d = run.quranic ? decos.quran : run.vocalised ? decos.vocalised : decos.plain;
        if (!skip) builder.add(start, line.from + run.to, d);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const scriptRunPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      )
        this.decorations = build(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export function scriptRuns(): Extension {
  return scriptRunPlugin;
}
