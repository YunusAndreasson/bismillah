// node --test spikes/transliteration/
import assert from "node:assert/strict";
import { test } from "node:test";
import { Typist } from "./converter.ts";
import { FINAL } from "./tables.ts";

function typed(keys: string, smartPunctuation = true): Typist {
  const typist = new Typist({ translit: FINAL, smartPunctuation });
  typist.typeAll(keys);
  return typist;
}

const out = (keys: string, smart = true): string => typed(keys, smart).text();

test("macrons: vowel then =", () => {
  assert.equal(out("Qa=di= Iya=d"), "Qādī Iyād");
  assert.equal(out("A=l `Imra=n"), "Āl ʿImrān");
  assert.equal(out("I= U="), "Ī Ū");
});

test("hyphenated particles and compounds are left alone", () => {
  assert.equal(out("wa-l-`ilm, bi-lla=h, li-l-na=s, fa-qa=la"), "wa-l-ʿilm, bi-llāh, li-l-nās, fa-qāla");
  assert.equal(out("the Sunni-Shi`i divide, a multi-ethnic state"), "the Sunni-Shiʿi divide, a multi-ethnic state");
});

test("dots below: dot before the letter", () => {
  assert.equal(out(".hadi=th, .sala=h, .dala=l, .taha=ra, .zulm"), "ḥadīth, ṣalāh, ḍalāl, ṭahāra, ẓulm");
  assert.equal(out(".Hanbali=, .Sa=diq, .Ta=`if"), "Ḥanbalī, Ṣādiq, Ṭāʿif");
  assert.equal(out("A.hmad and i.sla=.h"), "Aḥmad and iṣlāḥ");
});

test("sentence ends and upper-case abbreviations are left alone", () => {
  assert.equal(out("Alla=h. Then"), "Allāh. Then");
  assert.equal(out("1000 A.H./1591 C.E., 800 A.D., a Ph.D. in the U.S. P.S."), "1000 A.H./1591 C.E., 800 A.D., a Ph.D. in the U.S. P.S.");
});

test("an ellipsis is one unit, so a letter after it never takes a dot", () => {
  assert.equal(out("wait...then"), "wait…then");
});

test("ʿayn from a backtick, including at the start of a line", () => {
  assert.equal(out("`ilm and al-`Arab"), "ʿilm and al-ʿArab");
  assert.equal(out("`Umar said\n`Ali= said"), "ʿUmar said\nʿAlī said");
});

test("fences and double backticks survive: a second backtick undoes the ʿ", () => {
  assert.equal(out("```\nqiya=s .h `x ''\n```\nafter: `ilm"), "```\nqiya=s .h `x ''\n```\nafter: ʿilm");
  assert.equal(out("a span ``x`` here"), "a span ``x`` here");
});

test("hamza from two apostrophes, with smart punctuation on or off", () => {
  assert.equal(out("Qur''a=n, `ulama=''"), "Qurʾān, ʿulamāʾ");
  assert.equal(out("Qur''a=n, `ulama=''", false), "Qurʾān, ʿulamāʾ");
  assert.equal(out("it's 'quoted'"), "it’s ‘quoted’");
});

test("Backspace straight after a conversion restores the typed keys", () => {
  for (const [keys, before, raw] of [
    ["x.h", "xḥ", ".h"],
    ["a=", "ā", "a="],
    ["`", "ʿ", "`"],
    ["Qur''", "Qurʾ", "''"],
    ['say "', "say “", '"'],
    ["10--", "10–", "--"],
    ["so...", "so…", "..."],
  ] as const) {
    const typist = typed(keys);
    assert.equal(typist.text(), before, keys);
    assert.equal(typist.backspace(), raw, keys);
    assert.equal(typist.text(), keys, keys);
  }
});

test("restored keys never convert again, and Backspace later is an ordinary delete", () => {
  const typist = typed("Qur''");
  typist.backspace();
  typist.type("'");
  assert.equal(typist.text(), "Qur''’");
  typist.type("a");
  assert.equal(typist.backspace(), null);
  assert.equal(typist.text(), "Qur''’");
});

test("only just-typed keys convert: a sequence split by another key does not", () => {
  assert.equal(out(". h"), ". h");
  assert.equal(out("a =b"), "a =b");
});

test("undoing the opening backtick of inline code keeps the code literal", () => {
  const typist = typed("see `");
  typist.backspace();
  typist.typeAll("a=b .h''` and `ilm");
  assert.equal(typist.text(), "see `a=b .h''` and ʿilm");
});

test("no conversion in code, URLs, link targets or frontmatter; link text converts", () => {
  assert.equal(out("---\ntitle: a= .h\n---\n.hadi=th"), "---\ntitle: a= .h\n---\nḥadīth");
  assert.equal(out("https://example.org/a=b/.html and a="), "https://example.org/a=b/.html and ā");
  assert.equal(out("[al-Fa=ti.ha](https://quran.com/a=1.html)"), "[al-Fātiḥa](https://quran.com/a=1.html)");
  assert.equal(out("    indented a= .h\n\n.h"), "    indented a= .h\n\nḥ");
});

test("smart punctuation: dashes, rules, tables and Arabic guillemets", () => {
  assert.equal(out("pp. 10--12, a pause --- then"), "pp. 10–12, a pause — then");
  assert.equal(out("text\n\n---\n"), "text\n\n---\n");
  assert.equal(out("| a | b |\n|---|---|"), "| a | b |\n|---|---|");
  assert.equal(out('قال "العلم نور"'), "قال «العلم نور»");
});
