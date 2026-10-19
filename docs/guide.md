---
title: The bismillah guide
lang: en
---

# The bismillah guide

bismillah is a calm Markdown editor. It keeps your writing in plain files on your own computer, sets it in carefully chosen type, and stays out of the way. Everything it does is in this guide.

This guide is a sample document. Try anything here: type, change the settings, press the shortcuts. Nothing you change in it is saved, and `F1` (*Help › Guide*) opens it again as it was.

## Your files

Your writing lives in **Markdown files** (ending in `.md` or `.markdown`) in a folder you choose, called the **library**. bismillah has no database and no account: the files are the writing, and any other program can open them.

- *Open folder…* (`Ctrl+Shift+O`) makes a folder the library.
- *Open…* (`Ctrl+O`) opens one file. A file from outside the library makes its folder the library.
- *New file…* (`Ctrl+N`) asks where to save a new file, starting in the folder you have selected in the library. It never replaces a file that is already there.
- You can also drop a file or a folder on the window, or open one from your file manager with *Open with › bismillah*.

When nothing is open, bismillah offers just those three: open a folder, open a file, or start a new one.

### Saving

bismillah saves as you write. The status line at the bottom of the window says *Saving…* from your first change, and *Saved* only once the text is safely on disk. `Ctrl+S` (*Save now*) saves at once and shows that it did.

Your text is saved **exactly as you typed it**: line endings, vocalisation, punctuation and frontmatter are never changed. A file that isn’t UTF-8 text opens read-only and stays as it is.

### When saving fails

If a save fails, because the disk is full, say, or the folder has gone, a notice above the text says what happened, and the status line keeps saying *Not saved* until a save succeeds. Your text is kept in recovery meanwhile, so nothing is lost.

- *Try again* saves again; *Save elsewhere…* saves the text to another file.
- If another program changes the file while you are editing it, bismillah shows both possibilities: *Keep mine* saves your text over theirs, *Load theirs* replaces your text with the file as it is now (yours stays in recovery), and *Save mine as…* keeps both. A file changed elsewhere while you have no unsaved changes simply reloads.
- If bismillah or your computer stops before your text is saved, the text is waiting the next time you open that file: *Restore* puts it back, *Discard* lets it go. Other files with waiting text are mentioned when bismillah starts.

## Writing

### Text that reads as it will be read

Your document reads as **rendered text**: emphasis without its asterisks, links as their words, a dot for each list item, a bar beside a quotation, a short rule for `---`. The Markdown shows only in the paragraph you are writing, and appears without moving anything, so the text never jumps under your eyes.

- *Always show Markdown* (`Ctrl+R`) keeps every mark visible everywhere, as in the original iA Writer.
- A click puts the caret exactly where you clicked, and the paragraph’s Markdown appears when you release the button.
- Tables are drawn as grids, and code blocks sit on a quiet ground.
- The frontmatter at the top of a file (between two lines of `---`) folds to one quiet line until the caret goes into it.
- Footnotes and reference links are shown as such only when they are defined, so a scholarly [sic] keeps its brackets.

### Links and images

Hover over a link or an image to see its address. **`Ctrl`+click** on a link opens it in your browser, or in your mail app for an email address; *Open link* does the same for the link at the caret. Only web and email links open: never files, scripts or other programs.

An image shows below its line when it is a file inside your library. Images from the web are never loaded: a quiet note shows their address instead.

### Copy as rich text

*Copy as rich text* (`Ctrl+Shift+C`) puts the selection, or the whole document without its frontmatter, on the clipboard formatted, ready to paste into an email or a word processor. Nothing typographic is changed on the way.

### Headings, lists and the gutter

The `#` of a heading, the `>` of a quotation and the marks of a list hang in the margin, so your text keeps one straight edge. Heading levels are told apart by size, weight and space.

## Arabic, Qur’anic text and transliteration

Arabic is as much at home in bismillah as English. Each line takes its direction from its first letter, so an Arabic paragraph reads from the right:

> بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ

And Arabic words inside an English sentence keep their own order, as زهد (restraint) does here.

Arabic is set in Amiri. Qur’anic text in Uthmani spelling, recognised by its signs, is set in Amiri Quran and is never marked by the spelling checker.

### Smart punctuation

As you type, quotes, dashes and ellipses become their typographic forms. `Backspace` straight away gives you back exactly what you typed.

| You type | In English | In Arabic |
|---|---|---|
| `"` | “ or ” | « or » |
| `'` | ‘ or ’ | ’ |
| `--` inside a line | – | – |
| `---` inside a line | — | — |
| `...` | … | … |

A `---` at the start of a line stays Markdown. *Smart punctuation* can be turned off in Settings › Writing.

### Transliteration mode

*Transliteration mode* (`Ctrl+Shift+T`) types the letters of IJMES transliteration from your ordinary keyboard. While it is on, the status line says *Transliteration*.

| Type | Gets | Type | Gets |
|---|---|---|---|
| `a=` `i=` `u=` | ā ī ū | `A=` `I=` `U=` | Ā Ī Ū |
| `.h` `.s` `.d` `.t` `.z` | ḥ ṣ ḍ ṭ ẓ | `.H` `.S` `.D` `.T` `.Z` | Ḥ Ṣ Ḍ Ṭ Ẓ |
| `` ` `` | ʿ (ʿayn) | `''` | ʾ (hamza) |

The dot comes before its letter, so a full stop after a word never changes it, and abbreviations such as A.H. stay as they are. `Backspace` straight away undoes a change. Try it here: turn the mode on and type `.hadi=th` for ḥadīth.

## Focus

- **Zuhd mode** (`Ctrl+D`) keeps the sentence or paragraph you are writing clear and quietens the rest. Zuhd (زهد) is restraint: a quieter space for writing. Choose a sentence or a paragraph, and how quiet the other text becomes, in Settings › Writing.
- **Typewriter scrolling** (`Ctrl+T`) keeps the line you are writing a little above the middle of the window.
- **Fullscreen** (`F11`) leaves only the text.
- The status line can fade while you type (Settings › Appearance). Notices about saving never fade.
- Every document opens with the **Basmallah**, set above the text. It is never part of your file, never counted or checked, and Settings › Appearance can turn it off. A document that already begins with the Basmallah doesn’t show it twice.
- The status line shows the number of words and the reading time: information, never a target.

## Spelling and grammar

bismillah checks English and Arabic spelling and suggests English grammar corrections as you write, entirely on your computer. Nothing is sent anywhere.

- A possible spelling mistake has a **wavy** underline; a grammar suggestion a **dotted** one. Neither appears while you are still typing the word.
- `Ctrl+.` (*Show suggestions*) opens the suggestions for the word at the caret; `F7` and `Shift+F7` go to the next and previous one, and a right-click on a marked word opens them too.
- *Replace with* makes the change; `Ctrl+Z` undoes it. *Ignore* lets a word be in this document until you quit. *Add to dictionary* puts it in your own dictionary for good.
- Spelling is British by default. Choose another in Settings › Language & checking, or write `lang: en-US` in a document’s frontmatter.
- Qur’anic text, transliteration, code, addresses and Markdown are never checked. Words from Arabic written in plain letters are unknown until you add them to your dictionary.
- Grammar suggestions are about grammar only, never style, and every change is yours to make.
- *Check spelling* and *Grammar suggestions* turn each off, in the Edit menu, the palette and Settings.

## The library

`Ctrl+\` shows the library beside the text, or over it in a narrow window, and moves the keyboard into it. The open file is marked with a green bar.

- The arrows move through it; `→` opens a folder and `←` closes it; typing the first letters of a name finds it; `Enter` opens a file and puts the caret in it; `Esc` returns to the text.
- `F2` (*Rename…*) renames the selected file or folder, or the open document.
- `Ctrl+Shift+N` (*New folder…*) makes a folder in the selected one.
- `Delete` moves the selected file or folder to the trash, and *Undo* puts it straight back. bismillah never deletes anything outright.
- Files are listed in natural order, as a catalogue would list them: “Chapter 2” before “Chapter 10”, and “ʿIlm” under I.

### Quick open and the command palette

- **Quick open** (`Ctrl+P`) finds a file by its name or its folder. Matching ignores case, diacritics and vocalisation, so “hadith” finds “ḥadīth.md”, and files with the same name show their folders.
- **The command palette** (`Ctrl+Shift+P`) finds every command by its name or by other words for it, with its shortcut.
- **The menu bar** appears when you press `Alt` or `F10`.

## Settings, colours and shortcuts

**Settings** (`Ctrl+,`) is one screen in four parts: Appearance, Writing, Language & checking, and Files & privacy. Every change applies at once and is saved.

Your settings are plain text files in `~/.config/bismillah/`, which you may also edit in any text editor; changes apply as soon as you save them.

| File | What it holds |
|---|---|
| `settings.toml` | Every setting on the Settings screen |
| `keybindings.toml` | Your own keyboard shortcuts |
| `themes/` | Your own colour themes |
| `dictionary.txt` | Your dictionary, one word per line |

### Colours

Choose the colours in Settings › Appearance: bismillah’s own, *Sepia* or *Slate*, each in light and dark. *Theme* chooses light, dark or whatever your system uses, and *High contrast* gives black and white with the most contrast of all.

A colour theme of your own is a small TOML or JSON file in `~/.config/bismillah/themes/`. Its name, without the ending, appears under *Colours*:

```toml
schema = 1
name = "Dusk"

[light]
surface-editor = "#f4f1ea"
text-primary = "#22201c"

[dark]
surface-editor = "#16181c"
text-primary = "#d8d6d0"
```

A theme sets only colours, for light, dark or both: `surface-editor`, `surface-panel`, `text-primary`, `text-secondary`, `syntax-marker`, `accent`, `selection-background`, `border-control`, `diagnostic-spelling`, `diagnostic-grammar`, `status-error` and `focus-ring`. Anything it leaves out keeps bismillah’s colour. Settings lists any colour that is hard to read on its background, or anything in the file that can’t be used, in plain words.

### Keyboard shortcuts

*Create keybindings.toml* in Settings › Files & privacy writes a file listing every command with its shortcut, ready to change. Each line gives a command its shortcut, as the menus write it:

```toml
"editor.toggleFocus" = "Ctrl+Shift+D"
"app.guide" = ""
```

Changes apply everywhere as soon as you save the file, and an empty shortcut leaves a command without one. A shortcut needs `Ctrl` or `Alt` with a key, or a function key. The keys that edit text, copying and pasting, Undo, Redo and Select all, and `F10` keep their own meaning, and a key given to two commands goes to neither. Settings says which lines it couldn’t use, and why.

## Every shortcut

| Command | Shortcut |
|---|---|
| New file… | `Ctrl+N` |
| New folder… | `Ctrl+Shift+N` |
| Open… | `Ctrl+O` |
| Open folder… | `Ctrl+Shift+O` |
| Quick open… | `Ctrl+P` |
| Save now | `Ctrl+S` |
| Rename… | `F2` |
| Move to trash | `Delete` (in the library) |
| Settings | `Ctrl+,` |
| Quit | `Ctrl+Q` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Shift+Z` |
| Select all | `Ctrl+A` |
| Copy as rich text | `Ctrl+Shift+C` |
| Open link | `Ctrl`+click |
| Transliteration mode | `Ctrl+Shift+T` |
| Show suggestions | `Ctrl+.` |
| Next issue | `F7` |
| Previous issue | `Shift+F7` |
| Check spelling | — |
| Grammar suggestions | — |
| Library | `Ctrl+\` |
| Command palette | `Ctrl+Shift+P` |
| Zuhd mode | `Ctrl+D` |
| Typewriter scrolling | `Ctrl+T` |
| Always show Markdown | `Ctrl+R` |
| Bigger text | `Ctrl+=` |
| Smaller text | `Ctrl+-` |
| Default text size | `Ctrl+0` |
| Theme: System / Light / Dark | `Ctrl+Shift+L` |
| Fullscreen | `F11` |
| Guide | `F1` |
| About bismillah | — |
| Show the menu bar | `Alt` or `F10` |

## Your privacy

bismillah has no accounts, no sync, no telemetry, no advertising and no generative AI: nothing writes your text for you. It has no networking features, and it works without a network. The only things that leave it are the links you open yourself, which go to your browser.

It keeps a few files of its own, all on your computer:

- your settings, shortcuts, colour themes and dictionary in `~/.config/bismillah/`;
- unsaved text, while a save is under way or after one fails, in `~/.local/share/bismillah/recovery/`, readable only by you and removed once it is saved, discarded or 30 days old;
- the window’s size, the library and your recent files in `~/.local/share/bismillah/state.json`.

*Show in file manager* in Settings › Files & privacy opens each of these folders.

## From a terminal

```sh
bismillah notes.md        # opens a file
bismillah ~/Writing       # opens a folder as the library
bismillah --help          # says how, and exits
```

If bismillah is already running, the file or folder opens in its window.

## If something looks wrong

- **A blank or flickering window** on some graphics drivers: start bismillah with `WEBKIT_DISABLE_DMABUF_RENDERER=1` set.
- **Another font isn’t used**: the name must match an installed font exactly, as `fc-list` shows it. Until it does, Settings says so and iA Writer Duo is used.
- **A shortcut doesn’t work**: Settings › Files & privacy lists the lines of `keybindings.toml` that couldn’t be used.
- **A colour theme isn’t listed**: Settings › Appearance says what is wrong with the file.

## About bismillah

bismillah is inspired by Islamic ethics: your words are a trust (amanah), your privacy is kept, and the tool practises restraint. *About bismillah* in the Help menu has its version, its inspiration and the licences of everything it is made with. It is free software under the [GNU General Public License](https://www.gnu.org/licenses/gpl-3.0.html), version 3 or later: hover over that link to see where it leads, and `Ctrl`+click to open it.
