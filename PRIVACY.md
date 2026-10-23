# Privacy

bismillah is built so that your writing stays yours.

## What bismillah does

- **Reads and writes only the files and folders you choose.** The library is the one folder you open. bismillah lists the Markdown files in it, refuses any path that leads outside it (a link included), and notices changes other programs make there through your system's change notifications; to check the open file it reads only that file.
- **Never deletes anything outright.** *Move to trash* puts a file or folder in your system's trash, where you can get it back; *Undo* puts it back straight away.
- **Checks spelling and grammar entirely on your device.** No text is sent anywhere. Words you *Ignore* are remembered only until you quit; words you *Add to dictionary* go into your own `dictionary.txt` (below), which you can read and edit.
- **Stores its own small set of files on your computer:**
  - **Settings:** `settings.toml`, `keybindings.toml`, your personal `dictionary.txt` and any theme files, in your configuration folder (on Linux `~/.config/bismillah/`). bismillah notices when you change them in another program, through the same change notifications, and writes `keybindings.toml` only when you ask it to create one. When you choose *Another font* by name, it asks your system's font list (fontconfig) whether that font is installed.
  - **Recovery copies:** while a save is in progress, and whenever one fails or is refused because the file changed elsewhere, the text being saved is kept in the app's data folder (on Linux `~/.local/share/bismillah/recovery/`), so a crash or a full disk never loses it. Access is restricted to your user where the system supports it. A copy is deleted after a successful save or when you discard it, and copies are limited in size and kept for at most 30 days. They never go inside your writing folders.
  - **Where you left off:** the window's size, the library folder and whether the library was shown, the path of the last document you had open and of up to 20 recently opened files (for quick open), in `~/.local/share/bismillah/state.json`.
  - **Logs:** bismillah writes errors and warnings to its standard error output, which your desktop session may keep in its journal on your computer. They **never** contain your documents, their contents or the addresses of links in them.
- **Never opens links.** Hovering a link shows its address; nothing follows it, and nothing is handed to a browser, mail app or file manager.

## What bismillah never does

- No accounts, sign-in or sync.
- No telemetry, analytics, usage statistics or crash reports.
- No ads.
- No generative AI: nothing writes, rewrites or summarises your text. The grammar checker includes a small model that runs on your device like the rest of the checker; it only suggests, and you accept each change.
- No update checks, remote fonts or remote images. Images in your documents load only if they are files inside your library.

## Precise claims

We separate two statements and test each:

1. **bismillah works fully without a network.** Our test suite runs the real app with networking unavailable.
2. **bismillah contains no networking features.** No network libraries or network-capable plugins are included, the app's webview is locked down by a strict content security policy, and each release is audited.

We do not claim the app is *technically unable* to reach a network, because a content security policy is not an operating-system sandbox. If you want that guarantee at the operating-system level, run bismillah without network access (for example in a sandbox or behind your firewall's rules for it). A Flatpak without network permission is planned for when bismillah is published.
