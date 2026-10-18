# Privacy

bismillah is built so that your writing stays yours.

## What bismillah does

- **Reads and writes only the files and folders you choose.** The library is the one folder you open. bismillah lists the Markdown files in it, refuses any path that leads outside it (a link included), and notices changes other programs make there through your system's change notifications; to check the open file it reads only that file.
- **Never deletes anything outright.** *Move to trash* puts a file or folder in your system's trash, where you can get it back; *Undo* puts it back straight away.
- **Checks spelling and grammar entirely on your device.** No text is sent anywhere.
- **Stores its own small set of files on your computer:**
  - **Settings:** `settings.toml`, `keybindings.toml`, your personal `dictionary.txt` and any theme files, in your configuration folder (on Linux `~/.config/bismillah/`).
  - **Recovery copies:** while a save is in progress, and whenever one fails or is refused because the file changed elsewhere, the text being saved is kept in the app's data folder (on Linux `~/.local/share/bismillah/recovery/`), so a crash or a full disk never loses it. Access is restricted to your user where the system supports it. A copy is deleted after a successful save or when you discard it, and copies are limited in size and kept for at most 30 days. They never go inside your writing folders.
  - **Where you left off:** the window's size, the library folder and whether the library was shown, the path of the last document you had open and of up to 20 recently opened files (for quick open), in `~/.local/share/bismillah/state.json`.
  - **Logs:** local only, containing errors and warnings. They **never** contain your documents or their contents.

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

We do not claim the app is *technically unable* to reach a network, because a content security policy is not an operating-system sandbox. If you want that guarantee at the OS level, use a confined build (for example the Flatpak, which ships without network permission) or your system's firewall.

Following a link in a document opens it in **your** browser, and only when you explicitly `Ctrl`/`Cmd`-click it.
