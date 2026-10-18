// Candidate transliteration tables (IJMES). Each component (macrons, dots below, ʿayn,
// hamza) is evaluated on its own; `FINAL` is the recommended combination.

import { isLetter, type GuardContext, type Rule, type Table } from './converter.ts';

const AYN = 'ʿ'; // U+02BF MODIFIER LETTER LEFT HALF RING
const HAMZA = 'ʾ'; // U+02BE MODIFIER LETTER RIGHT HALF RING

const VOWELS: ReadonlyArray<readonly [string, string]> = [
  ['a', 'ā'],
  ['i', 'ī'],
  ['u', 'ū'],
  ['A', 'Ā'],
  ['I', 'Ī'],
  ['U', 'Ū'],
];
const EMPHATICS: ReadonlyArray<readonly [string, string]> = [
  ['h', 'ḥ'],
  ['s', 'ṣ'],
  ['d', 'ḍ'],
  ['t', 'ṭ'],
  ['z', 'ẓ'],
  ['H', 'Ḥ'],
  ['S', 'Ṣ'],
  ['D', 'Ḍ'],
  ['T', 'Ṭ'],
  ['Z', 'Ẓ'],
];

function macrons(make: (v: string) => string, guard?: Rule['guard']): Rule[] {
  return VOWELS.map(([v, out]) => ({ pattern: make(v), output: out, kind: 'macron', ...(guard ? { guard } : {}) }));
}

function dots(make: (c: string) => string, guard?: (ctx: GuardContext, upper: boolean) => boolean): Rule[] {
  return EMPHATICS.map(([c, out]) => ({
    pattern: make(c),
    output: out,
    kind: 'dot',
    ...(guard ? { guard: (ctx: GuardContext) => guard(ctx, c === c.toUpperCase()) } : {}),
  }));
}

const lastOf = (s: string): string => [...s].at(-1) ?? '';

/** Blocks `wa-`, `bi-`, `li-`, `fa-`…: a one-consonant, one-vowel particle before the hyphen. */
const notParticle: Rule['guard'] = ({ before }) => !/(?:^|[^\p{L}])\p{L}$/u.test(before);

/**
 * G1: an upper-case dot-below letter never follows a letter directly, so `A.H.`, `A.D.`,
 * `U.S.` and `Ph.D.` stay as typed. Lower case is unguarded, so `A.hmad` still gives Aḥmad.
 */
const upperNotAfterLetter = ({ before }: GuardContext, upper: boolean): boolean => {
  if (!upper) return true;
  return !isLetter(lastOf(before)); // `before` ends just before the typed "."
};

/** B1: a backtick at the start of a line (after indentation or block markers) stays as typed. */
const notLineStart: Rule['guard'] = ({ before }) => !/^\s*(?:(?:[>*+-]|\d+[.)])\s+)*$/u.test(before);
/** B2: a backtick right after a backtick stays as typed, so ``` and `` survive. */
const notAfterBacktick: Rule['guard'] = ({ before }) => lastOf(before) !== '`';
const both =
  (...guards: NonNullable<Rule['guard']>[]): Rule['guard'] =>
  (ctx) =>
    guards.every((g) => g(ctx));

/** B3: a second backtick straight after a backtick-made ʿ turns both back into ``. */
const backtickEscape: Rule = {
  pattern: '``',
  output: '``',
  kind: 'escape',
  guard: ({ replaced }) => replaced.at(-1)?.out === AYN,
};

export const MACRON_CANDIDATES: readonly Table[] = [
  { name: 'a- (proposal)', rules: macrons((v) => `${v}-`) },
  { name: 'a- + particle guard', rules: macrons((v) => `${v}-`, notParticle) },
  { name: 'a=', rules: macrons((v) => `${v}=`) },
  { name: 'a_', rules: macrons((v) => `${v}_`) },
  { name: 'aa', rules: macrons((v) => v + v) },
];

export const DOT_CANDIDATES: readonly Table[] = [
  { name: '.h (proposal)', rules: dots((c) => `.${c}`) },
  { name: '.h + G1', rules: dots((c) => `.${c}`, upperNotAfterLetter) },
  { name: 'h.', rules: dots((c) => `${c}.`) },
  { name: ',h', rules: dots((c) => `,${c}`) },
];

export const AYN_CANDIDATES: readonly Table[] = [
  { name: '` (proposal)', rules: [{ pattern: '`', output: AYN, kind: 'ayn' }] },
  { name: '` + B1 B2', rules: [{ pattern: '`', output: AYN, kind: 'ayn', guard: both(notLineStart, notAfterBacktick) }] },
  { name: '` + B2 B3', rules: [backtickEscape, { pattern: '`', output: AYN, kind: 'ayn', guard: notAfterBacktick }] },
  {
    name: '3 (not after digit)',
    rules: [{ pattern: '3', output: AYN, kind: 'ayn', guard: ({ before }) => !/\d$/u.test(before) }],
  },
];

export const HAMZA_CANDIDATES: readonly Table[] = [
  { name: "'' (proposal)", rules: [{ pattern: "''", output: HAMZA, kind: 'hamza' }] },
  { name: "' (ArabTeX)", rules: [{ pattern: "'", output: HAMZA, kind: 'hamza' }] },
];

export const FINAL: Table = {
  name: 'final: a= · .h+G1 · `+B2B3 · \'\'',
  rules: [
    ...macrons((v) => `${v}=`),
    ...dots((c) => `.${c}`, upperNotAfterLetter),
    backtickEscape,
    { pattern: '`', output: AYN, kind: 'ayn', guard: notAfterBacktick },
    { pattern: "''", output: HAMZA, kind: 'hamza' },
  ],
};

export const PROPOSAL: Table = {
  name: 'proposal: a- · .h · ` · \'\'',
  rules: [
    ...macrons((v) => `${v}-`),
    ...dots((c) => `.${c}`),
    { pattern: '`', output: AYN, kind: 'ayn' },
    { pattern: "''", output: HAMZA, kind: 'hamza' },
  ],
};
