# Privacy

bismillah is built so that your writing stays yours.

## What bismillah does

- **Reads and writes only the files and folders you choose.**
- **Checks spelling and grammar entirely on your device.** No text is sent anywhere.
- **Stores its own small set of files on your computer:**
  - **Settings:** `settings.toml`, `keybindings.toml`, your personal `dictionary.txt` and any theme files, in your configuration folder (on Linux `~/.config/bismillah/`).
  - **Recovery copies:** if something goes wrong before a save completes (a crash, a full disk), the unsaved text is kept in the app's data folder (on Linux `~/.local/share/bismillah/recovery/`). Access is restricted to your user where the system supports it. They are deleted after a successful save or when you discard them, and are limited in size and age. They never go inside your writing folders.
  - **Logs:** local only, containing errors and warnings. They **never** contain your documents or their contents.

## What bismillah never does

- No accounts, sign-in or sync.
- No telemetry, analytics, usage statistics or crash reports.
- No ads.
- No AI or language-model features.
- No update checks, remote fonts or remote images. Images in your documents load only if they are files inside your library.

## Precise claims

We separate two statements and test each:

1. **bismillah works fully without a network.** Our test suite runs the real app with networking unavailable.
2. **bismillah contains no networking features.** No network libraries or network-capable plugins are included, the app's webview is locked down by a strict content security policy, and each release is audited.

We do not claim the app is *technically unable* to reach a network, because a content security policy is not an operating-system sandbox. If you want that guarantee at the OS level, use a confined build (for example the Flatpak, which ships without network permission) or your system's firewall.

Following a link in a document opens it in **your** browser, and only when you explicitly `Ctrl`/`Cmd`-click it.
