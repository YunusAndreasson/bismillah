# Phase 0 spikes

Each spike answers one question from PLAN.md with evidence from the real app (WebKitGTK 2.54.1, Tauri 2.12, this machine) and ends with **go**, **adjust** or **no-go**. The short result is recorded in the ADR it informs; the evidence is here. Spike code lives in `spikes/` and `tests/e2e/spikes/`.

| Spike | Verdict | Report | ADR |
|---|---|---|---|
| Hanging marks | **go** | [hanging-marks-and-bidi.md](hanging-marks-and-bidi.md) | 0002 |
| Bidi | **go** (boundary slots documented) | [hanging-marks-and-bidi.md](hanging-marks-and-bidi.md) | 0002 |
| Font profiles | **adjust** (Serif measure, line room for vocalised and Qur'anic runs) | [font-profiles.md](font-profiles.md) | 0007 |
| Arabic speller | **go: spellbook**; Hunspell binding **no-go** | [arabic-speller.md](arabic-speller.md) | 0004 |
| Harper | **adjust** (p95 over budget; embedded model) | [harper-latency.md](harper-latency.md) | 0004 |
| Basmallah | **go** (rendering affected by the WebKit bug) | [basmallah.md](basmallah.md) | 0008 |
| Real-app testing | **go** | [real-app-testing.md](real-app-testing.md) | 0009 |
| Uthmani + transliteration glyphs | **adjust**: fonts go, WebKit misplaces Arabic marks | [glyphs.md](glyphs.md), [arabic-rendering.md](arabic-rendering.md) | 0007, 0011 |
| Native menu | **go** (GTK/X11; GNOME untested) | [native-menu.md](native-menu.md) | 0009 |
| Keyboard input | **go** (X11/GTK); transliteration table **adjust** | [keyboard-input.md](keyboard-input.md), [transliteration.md](transliteration.md) | 0010 |

**Blocking finding:** WebKitGTK drops the vertical offsets HarfBuzz gives Arabic marks ([arabic-rendering.md](arabic-rendering.md), proposed ADR-0011). It needs the author's decision before Phase 1's typography work.
