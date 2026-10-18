# Alignment interview — 2026-10-18

An interview with the author after the foundation docs were written. The decisions below have been folded into DESIGN.md, ARCHITECTURE.md, PLAN.md, AGENTS.md and ADRs 0004, 0007, 0008 and 0010. This file records what was asked and answered.

## Writer and languages
| Question | Answer |
|---|---|
| What will you mostly write? | Long-form prose; Islamic studies / Arabic |
| Arabic in a typical document | Some Arabic phrases in mostly English text |
| Interface language for 1.0 | English only (labels centralised for later translation) |
| Basmallah opening | On by default, can be turned off |
| Qur'an quotations | Uthmani orthography too → Amiri Quran for runs with Qur'anic marks |
| Transliteration | Yes, needs easy input |
| Transliteration convention | IJMES |

## Writing experience
| Question | Answer |
|---|---|
| Default writing font | iA Writer Duo |
| Long-form aids in 1.0 | Footnotes only (jump to heading moved to Later) |
| Transliteration input | Postfix-style sequences, active only in a toggled transliteration mode |
| Accent colour | Deep green (`#1E6B4A` light / `#6FBF95` dark, contrast-checked) |
| Chrome while typing | Fade while typing (iA); errors never fade |
| On by default | Typewriter scrolling, smart punctuation, spelling underlines, grammar underlines |
| Arabic quotes with smart punctuation | « » guillemets |
| Typewriter line position | Slightly above centre (about 42%) |
| Zuhd mode default focus | Paragraph |

## Files and output
| Question | Answer |
|---|---|
| Library display | Filename, natural sort, folders first |
| New file (`Mod-N`) | Ask for the filename first |
| Output in 1.0 | Preview mode; Copy as rich text (Print/PDF and HTML export moved to Later) |
| Qur'anic text and spellcheck | Skip Arabic runs containing Qur'anic annotation characters automatically |

## Project
| Question | Answer |
|---|---|
| Hosting (when published) | GitHub, personal account |
| Licence | GPL-3.0-or-later |
| Working mode with Claude | Autonomous phases; stop at each phase's acceptance check |
| Visibility | Private: only the author runs it, on this computer, for now |
| Repo and CI | Local git only; `pnpm verify` instead of CI |
| Install | Local Arch `PKGBUILD` (`makepkg -si`) |
