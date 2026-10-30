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
- *New file…* (`Ctrl+N`) asks where to save a new file, starting in the folder of the open document, or of the file you have highlighted in Search. It never replaces a file that is already there.

When nothing is open, bismillah offers those three: open a folder, open a file, or start a new one. A quiet *Guide* button opens this guide.

### Saving

bismillah saves as you write. The status line at the bottom of the window says *Saving…* from your first change, and *Saved* only once the text is safely on disk. `Ctrl+S` (*Save now*) saves at once and shows that it did.

An explicit save confirms *Saved now* once it has finished; that message clears when you edit or change documents. Saving a sample explains that its changes cannot be saved: copy text you want to keep into a new file. A read-only file stays unchanged.

Your text is saved **exactly as you typed it**: line endings, vocalisation, punctuation and frontmatter are never changed. A file that isn’t UTF-8 text opens read-only and stays as it is.

### When saving fails

If a save fails, because the disk is full, say, or the folder has gone, a notice above the text says what happened, and the status line keeps saying *Not saved* until a save succeeds. When a recovery copy has been made, the notice says so. If recovery also fails, your text stays in the window: bismillah refuses to replace or close it until a durable copy exists. Use *Save elsewhere…* to keep it in another file. A sudden power loss can still lose edits that have not reached the disk or recovery.

- *Try again* saves again; *Save elsewhere…* saves the text to another file.
- If another program changes the file while you are editing it, bismillah shows both possibilities: *Keep mine* saves your text over theirs, *Load theirs* replaces your text with the file as it is now (yours stays in recovery), and *Save mine as…* keeps both. A file changed elsewhere while you have no unsaved changes simply reloads.
- If bismillah or your computer stops before your text is saved, the text is waiting the next time you open that file: *Restore* puts it back, *Discard* lets it go. Other files with waiting text are mentioned when bismillah starts. You can open that recovery even if its original file or folder has gone. After *Restore*, use *Save it again* to recreate a missing file or *Save elsewhere…* to choose another location; opening recovery does not create files or folders.

## Writing

### Text that reads as it will be read

Your document reads as **rendered text**: emphasis without its asterisks, links as their words, a dot for each list item, a bar beside a quotation, a short rule for `---`. The Markdown shows only in the paragraph you are writing, and appears without moving anything, so the text never jumps under your eyes.

- *Always show Markdown* (`Ctrl+R`) keeps every mark visible everywhere, as in the original iA Writer.
- A click puts the caret exactly where you clicked, and the paragraph’s Markdown appears when you release the button.
- Tables are drawn as grids, and code blocks sit on a quiet ground.
- The frontmatter at the top of a file (between two lines of `---`) folds to one quiet line until the caret goes into it.
- Footnotes and reference links are shown as such only when they are defined, so a scholarly [sic] keeps its brackets.
- `Enter` starts a new paragraph, with the blank line Markdown needs, so one press is enough; `Backspace` straight away takes it back. `Shift+Enter` breaks the line within the paragraph, and in a list `Enter` starts the next item.
- `Esc` puts the pen down: the caret goes, the paragraph you were in shows its rendered look, and Zuhd mode lights nothing, so you can read the page as a whole. Any key that types or moves the caret, or a click, carries on where you were.

### Formatting

Select some words and a small bar appears above them: bold, italic, strikethrough and code, what the line is (text, a heading, a quote or a list), and the writing font. Everything it writes is ordinary Markdown, so your file reads the same anywhere.

- `F6` moves from the text into the bar, the arrow keys move along it, and `Esc` goes back with your words still selected.
- A button that is greyed out would not work in Markdown here. A bold mark can’t close between a quotation mark and a letter, for instance.
- With no selection, a shortcut such as `Ctrl+B` acts on the word the caret is in.
- The font changes how every document looks, and never changes a file. Markdown has no way to give a few words their own font.
- Don’t want the bar? Turn off *Formatting bar* in Settings › Writing; the shortcuts and the Format menu stay.

### Links and images

Hover over a link or an image to see its address. Links never open: bismillah works without a network.

An image shows below its line when it is a file inside your library. Images from the web are never loaded: a quiet note shows their address instead.

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
- The status line shows the reading time, quietly, at the right: information, never a target.

## Spelling and grammar

bismillah checks English and Arabic spelling and suggests English grammar corrections as you write, entirely on your computer. Nothing is sent anywhere.

- A possible spelling mistake has a **wavy** underline; a grammar suggestion a **dotted** one. Neither appears while you are still typing the word.
- `Ctrl+.` (*Show suggestions*) opens the suggestions for the word at the caret; `F7` and `Shift+F7` go to the next and previous one, and a right-click on a marked word opens them too.
- *Replace with* makes the change; `Ctrl+Z` undoes it. *Ignore* lets a word be in this document until you quit. *Add to dictionary* puts it in your own dictionary for good.
- Spelling is British by default. Choose another in Settings › Language & checking, or write `lang: en-US` in a document’s frontmatter.
- Qur’anic text, transliteration, code, addresses and Markdown are never checked. Words from Arabic written in plain letters are unknown until you add them to your dictionary.
- Grammar suggestions are about grammar only, never style, and every change is yours to make.
- *Check spelling* and *Grammar suggestions* turn each off, in the Edit menu, Search and Settings.

## Search

**Search** (`Ctrl+K`, or *Search* at the bottom left of the window) finds your files, the commands and the settings in one place. It opens near the top with the keyboard in its search field, so you can type at once.

- With nothing typed, it lists the files you opened recently, so `Ctrl+K` then `Enter` goes back to the one before this. Type to find a file, a command or a setting: each kind has its own heading, a few of each, and a heading's number says how many there are in all.
- `Ctrl+P` opens Search for files only, `Ctrl+Shift+P` for commands and `Ctrl+,` for settings. The kind shows at the start of the field; click it, or press `Backspace` in an empty field, to search everything again. Pressed again, the same key closes Search.
- `Tab` moves to the next kind (everything, files, commands, settings) and `Shift+Tab` back, **keeping what you typed**.
- Tap `Shift` twice to open Search, and twice again to close it. Typing a capital never opens it, nor does `Shift` with `Ctrl` or `Alt` held, so switching keyboard layouts is safe.
- `↑` and `↓` move the highlight (`Page Up` and `Page Down` a page at a time); `Enter` acts on it. The line under the list says what the highlighted row is, and the line below it what the keys do.
- `Esc` closes Search, as does a click outside it.
- Matching ignores case, diacritics and vocalisation, so “hadith” finds “ḥadīth.md”.

### Files

With only files, Search lists your recent files, then every file, in natural order as a catalogue would list them: “Chapter 2” before “Chapter 10”, and “ʿIlm” under I. Each shows its folder at the right, so files with the same name are told apart.

- Type part of a name or a folder to find a file. Folders that match are listed too; `Enter` on a folder shows what is in it, as if you had typed its name and a `/`. Typing `Essays/` yourself does the same.
- `Enter` opens a file and puts the caret in it.
- `F2` (*Rename…*) renames the highlighted file or folder; Search stays open on its new name. Elsewhere, `F2` renames the open document.
- `Delete` moves the highlighted file or folder to the trash, once nothing is after the caret in the search field, and *Undo* puts it straight back. bismillah never deletes anything outright.
- `Ctrl+N` and `Ctrl+Shift+N` make a new file or folder beside the highlighted one, or in it when it is a folder.
- With no folder open, Search offers *Open a folder…*; with an empty one, *New file…*.

### Commands

Every command that can run now, grouped as the menus group them, with its shortcut. A switch such as *Zuhd mode* says *On* or *Off*, and `Enter` changes it without closing Search; any other command closes Search and runs.

**The menu bar** appears when you press `Alt` or `F10`.

## Finding text and moving around

**Find…** (`Ctrl+F`) searches this document; **Replace…** (`Ctrl+H`) focuses the replacement field. `Enter` finds the next match, `Shift+Enter` the previous; `F3` and `Shift+F3` also work while writing. The panel offers case-sensitive, whole-word and regular-expression search. Replacement happens only when you choose *Replace* or *Replace all*, and Undo restores it. Find compares Unicode-equivalent forms on a temporary copy; it never changes the document by itself. Arabic vowel marks remain part of the query. `Esc` closes Find and returns to writing.

Find tells you when there are no matches and explains an invalid regular expression beside the field. What you find and its replacement follow their own writing direction.

**Go to line…** (`Ctrl+Alt+G`) accepts a line number, `+10` or `-10` lines from here, `50%` of the document’s lines, or `12:4` (line 12, column 4; columns start at 0). It moves the caret without changing text.

The panel shows these examples. If a position cannot be understood, it stays open with an explanation so you can correct it or press `Esc`. Spaces around a position are ignored.

## Settings, colours and shortcuts

**Settings** (`Ctrl+,`) opens Search for settings, which lists every setting in four parts: Appearance, Writing, Language & checking, and Files & privacy. Type to find one by its name or by other words for it (“leading” finds *Line height*). Every change applies at once and is saved.

- A switch, such as *Smart punctuation*, says *On* or *Off*; `Enter` changes it.
- A choice, such as *Line length*, or a size, such as *Text size*, changes with `←` and `→` while Search is narrowed to settings. `Enter` opens it in place to show every choice, or a size's − and + buttons (`Backspace` returns a size to its default); `Enter` or `Esc` closes it again.
- Sizes stop at their limits. A line height marked *font default* follows your writing font, and *Reset* returns to it.
- *Library folder* opens another folder; *Keyboard shortcuts*, *Your settings*, *Unsaved text* and *Privacy* say where things are kept.
- If settings cannot be saved, Search says why and offers *Try again* for your current choices.

Your settings are plain text files in `~/.config/bismillah/`, which you may also edit in any text editor; changes apply as soon as you save them.

| File | What it holds |
|---|---|
| `settings.toml` | Every setting in *Settings* |
| `keybindings.toml` | Your own keyboard shortcuts |
| `themes/` | Your own colour themes |
| `dictionary.txt` | Your dictionary, one word per line |

### Colours

Choose the colours in Settings › Appearance (*Colours*): bismillah’s own, *Sepia* or *Slate*, each in light and dark. *Theme* chooses light, dark or whatever your system uses, and *High contrast* gives black and white with the most contrast of all.

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
| Files | `Ctrl+P` |
| Save now | `Ctrl+S` |
| Rename… | `F2` |
| Move to trash | `Delete` (on a file in Search) |
| Settings | `Ctrl+,` |
| Quit | `Ctrl+Q` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Shift+Z` |
| Select all | `Ctrl+A` |
| Find… | `Ctrl+F` |
| Replace… | `Ctrl+H` |
| Find next | `F3` |
| Find previous | `Shift+F3` |
| Go to line… | `Ctrl+Alt+G` |
| Transliteration mode | `Ctrl+Shift+T` |
| Bold | `Ctrl+B` |
| Italic | `Ctrl+I` |
| Strikethrough | `Ctrl+Shift+X` |
| Code | `Ctrl+E` |
| Text | `Ctrl+Alt+0` |
| Heading 1 | `Ctrl+Alt+1` |
| Heading 2 | `Ctrl+Alt+2` |
| Heading 3 | `Ctrl+Alt+3` |
| Quote | `Ctrl+Shift+.` |
| Bulleted list | `Ctrl+Shift+8` |
| Numbered list | `Ctrl+Shift+7` |
| Go to the formatting bar | `F6` |
| Show suggestions | `Ctrl+.` |
| Next issue | `F7` |
| Previous issue | `Shift+F7` |
| Check spelling | — |
| Grammar suggestions | — |
| Commands | `Ctrl+Shift+P` |
| Search | `Ctrl+K`, or `Shift Shift` |
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

## On the bismillah stick

The bismillah stick starts a computer straight into bismillah, with your texts encrypted on the stick. Your passphrase opens them; nothing else runs, and nothing leaves the stick.

- **Lock** hides your texts until you type the passphrase again. Closing the lid, and *Suspend*, lock before the computer sleeps.
- **Power off** (`Ctrl`+`Q`), **Restart** and **Suspend** are in the File menu and Search. Each saves first.
- The **battery** and the **clock** are at the end of the status line. At 10% bismillah tells you; at 3% it saves and powers off. That narrows the chance of losing what you just typed, but a battery can still die suddenly, so save as you would anywhere.
- **Settings › This stick** has your keyboard layouts (up to four, and the key that switches between them), the time zone, and a correction for computers whose clock keeps local time, as Windows sets it. Applying layouts restarts bismillah, which saves first and comes back to where you were.
- The library is always the `Texts` folder on the stick.

## Your privacy

bismillah has no accounts, no sync, no telemetry, no advertising and no generative AI: nothing writes your text for you. It has no networking features, and it works without a network. It never opens links or other apps.

It keeps a few files of its own, all on your computer:

- your settings, shortcuts, colour themes and dictionary in `~/.config/bismillah/`;
- unsaved text, while a save is under way or after one fails, in `~/.local/share/bismillah/recovery/`, readable only by you and removed once it is saved, discarded or 30 days old;
- the window’s size, the library and your recent files in `~/.local/share/bismillah/state.json`.

## If something looks wrong

- **A shortcut doesn’t work**: Settings › Files & privacy lists the lines of `keybindings.toml` that couldn’t be used.
- **A colour theme isn’t listed**: Settings › Appearance says what is wrong with the file.

## About bismillah

bismillah is inspired by Islamic ethics: your words are a trust (amanah), your privacy is kept, and the tool practises restraint. *About bismillah* in the Help menu has its version, its inspiration and the licences of everything it is made with. It is free software under the [GNU General Public License](https://www.gnu.org/licenses/gpl-3.0.html), version 3 or later: hover over that link to see where it leads.
