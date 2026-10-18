---
title: Specimen
lang: en
---

# The Specimen Document

This file exercises every element bismillah must typeset well. Use it for design review, Phase 0 spikes and visual regression. **Do not "fix" the deliberate mistakes** further down; they are test cases.

## Prose and emphasis

A writer sits down with nothing but a blank page and a quiet mind. The page fills slowly, one sentence at a time, and the sentences find their order. This paragraph is long enough to wrap several times at every measure, so line length, line height and rag can be judged on real text rather than on a single line.

Text can be *emphasised*, **strong**, ***both***, ~~struck through~~, or contain `inline code`. Numbers in prose: 1,234 words, 3.14, 2026. Punctuation: “curly quotes”, ‘single’, an em dash — and an en dash in 10–12, an ellipsis…

A [link with text](https://example.com) and a bare autolink https://example.com/a/very/long/path/that/should/wrap/gracefully/without/breaking/the/layout.

### A third-level heading

#### A fourth-level heading

##### A fifth-level heading

###### A sixth-level heading

Each heading level must be distinguishable by size, weight and spacing, and not by colour or small caps alone.

## Lists

- A first item
- A second item that is long enough to wrap onto a second line, so the hanging indent of the marker can be checked
  - A nested item
    - A deeper nested item
- A final item

1. Ordered one
2. Ordered two
10. Ordered ten (wider marker)

- [ ] An open task
- [x] A completed task

## Quotes

> A blockquote is set apart by its hanging mark, not by a box.
> It can span lines.
>
> > And nest.

## Code

```rust
fn main() {
    println!("bismillah");
}
```

## Table

| Profile | Size | Line height |
|---|---:|---:|
| iA Writer Duo | 20 | 1.6 |
| Source Serif 4 | 21 | 1.6 |
| Amiri | 24 | 1.8 |

## Footnote

Footnotes stay quiet until needed.[^1]

[^1]: Like this one.

---

## Arabic

### عنوانٌ عربي

الكتابةُ أمانةٌ، والكلمةُ مسؤوليةٌ. هذه فقرةٌ عربيةٌ طويلةٌ بما يكفي لتلتفَّ على أكثرِ من سطرٍ، حتى نتمكّنَ من الحكمِ على طولِ السطرِ وارتفاعِه ومساحةِ الحركاتِ بين الأسطر.

نصٌّ بلا تشكيل: الكتابة رحلة هادئة بين القلب والقلم، والصفحة البيضاء بداية كل شيء.

الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ

- عنصرٌ أوّل في قائمة
- عنصرٌ ثانٍ أطولُ قليلًا حتى يلتفَّ على سطرٍ آخرَ ونرى المسافةَ البادئةَ المعلّقة
  - عنصرٌ متداخل

> اقتباسٌ عربيٌّ قصير.

## Qur'anic text (Uthmani)

Pasted Uthmani text with Qur'anic annotation marks. It must render in Amiri Quran, survive saving byte for byte, and never be spellchecked. *Copied verbatim from Tanzil (Uthmani, without tatweel) on 2026-10-18; never normalise it. More verses are in `tests/fixtures/quran/`.*

ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ

## Transliteration (IJMES)

al-Fātiḥa, Qurʾān, ḥadīth, ʿilm, ṣalāh, ḍalāl, ṭahāra, ẓulm, Ibn Taymiyya, Āl ʿImrān, Ḥanbalī, ʿAbd al-Raḥmān.

## Mixed script

The word أمانة means *trust*, and زهد is the name of focus mode.

نستخدم Markdown لكتابة النصوص، ويُحفظ كلُّ ملفٍّ باسمٍ مثل `notes.md` في مجلدٍ تختاره.

An Arabic phrase with a link: [الصفحة الرئيسية](https://example.com) inside English text.

A number inside Arabic: سُجِّلت 1234 كلمة في 2026.

## Smart punctuation (typing fixtures)

Typed with smart punctuation on, these should read: “quoted”, it’s, 10–12, a pause — then … and in Arabic: «اقتباس».

## Deliberate mistakes (lint fixtures)

Spelling: I will recieve the letter tomorow.

Grammar: This is a apple. Their is a problem with the the sentence.

Inside code, nothing is flagged: `recieve`, and inside a URL: https://example.com/recieve
