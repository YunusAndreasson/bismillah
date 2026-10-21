//! Appliance mode (os/PLAN.md): bismillah as the whole surface of the bismillah stick,
//! started by its session as `cage -d -- bismillah --appliance`. A desktop launch never
//! passes the flag, so none of this runs there.
//!
//! The app starts before the writer's home is open. Everything that reads home waits
//! in [`Gate`] while the page shows Setup or Unlock; the helper (`bismillah-helper`,
//! crates/bismillah-appliance) opens home, and the app then continues in this same
//! process (docs/spikes/os-unlock-in-app.md). The library is always `~/Texts`, and the
//! app's own files have fixed places under home, while WebKit, GTK, fontconfig and Mesa
//! keep theirs in RAM (the session's `XDG_*_HOME`).

use bismillah_appliance::passphrase::{self, Secret, Strength};
use bismillah_appliance::{Answer, Event, Home, Keyboard, MAX_LINE, PowerAction, Report, Request};
use serde::Serialize;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::DirBuilderExt;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// The flag the stick's session passes.
const FLAG: &str = "--appliance";

/// Exit code after a keyboard change: systemd restarts the session, and cage starts
/// with the new layouts (cage has no way to change them while it runs).
const RESTART_SESSION: i32 = 76;

/// Whether this launch is the stick's session.
pub fn enabled(args: &[String]) -> bool {
    args.iter().skip(1).any(|a| a == FLAG)
}

static ACTIVE: OnceLock<bool> = OnceLock::new();

/// Records, once at launch, whether this is the stick's session.
pub fn set_active(appliance: bool) {
    let _ = ACTIVE.set(appliance);
}

/// Whether this is the stick's session: links, the file manager and window sizes are
/// not for it.
pub fn active() -> bool {
    ACTIVE.get().copied().unwrap_or(false)
}

/// What the stick was built from, for About.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Stick {
    /// The commit the app and helper were built from.
    commit: String,
    /// The Debian snapshot the system was built from (`20261021T083704Z`).
    snapshot: String,
}

/// Read from the files the image build writes (os/build/build-app.sh,
/// os/scripts/build.sh); null on the desktop.
pub fn stick() -> Option<Stick> {
    if !active() {
        return None;
    }
    let read = |name: &str| {
        std::fs::read_to_string(Path::new("/usr/share/bismillah").join(name))
            .map(|s| s.trim().to_owned())
            .unwrap_or_default()
    };
    Some(Stick {
        commit: read("commit"),
        snapshot: read("snapshot"),
    })
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// The library on the stick, `~/Texts`, private to the writer whatever the session's
/// umask (PAM's login session sets its own). The helper makes it at setup; this makes
/// it again if it went missing. `None` when it can't be made: the app then starts with
/// no library, as on the desktop.
pub fn library() -> Option<PathBuf> {
    let dir = home()?.join("Texts");
    match std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&dir)
    {
        Ok(()) => Some(dir),
        Err(e) => {
            eprintln!("bismillah: no library folder: {:?}", e.kind());
            None
        }
    }
}

/// The app's own settings and data folders on the stick: fixed under home, rather than
/// wherever `XDG_CONFIG_HOME` and `XDG_DATA_HOME` point (RAM, in the session).
pub fn dirs() -> Option<(PathBuf, PathBuf)> {
    let home = home()?;
    Some((
        home.join(".config/bismillah"),
        home.join(".local/share/bismillah"),
    ))
}

/// Whether boot marks are printed: in the stick's debug image (`BISMILLAH_MARKS=1`).
/// Release images print nothing.
pub fn marks() -> bool {
    std::env::var_os("BISMILLAH_MARKS").is_some()
}

/// Prints `BISMILLAH_MARK <name> <uptime seconds>`, for the OS boot-stage numbers.
/// Names and times only, never anything from a document or a passphrase.
pub fn mark(name: &str) {
    if !marks() {
        return;
    }
    let uptime = std::fs::read_to_string("/proc/uptime").unwrap_or_default();
    let seconds = uptime.split(' ').next().unwrap_or("?");
    // Not println!, which panics when stdout can't be written.
    let _ = writeln!(std::io::stdout(), "BISMILLAH_MARK {name} {seconds}");
}

/// The helper's socket. Debug builds may name another, for the desktop e2e suite's
/// stand-in helper (tests/e2e/appliance.e2e.ts).
fn socket() -> PathBuf {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("BISMILLAH_HELPER_SOCKET") {
        return PathBuf::from(path);
    }
    PathBuf::from(bismillah_appliance::SOCKET)
}

/// One request to the helper and its answer. The request line, which may hold a
/// passphrase, is cleared once it has been sent.
fn ask(request: Request) -> Result<Answer, String> {
    let line = request.to_line();
    let mut stream =
        UnixStream::connect(socket()).map_err(|e| format!("connect: {:?}", e.kind()))?;
    stream
        .write_all(&line)
        .map_err(|e| format!("write: {:?}", e.kind()))?;
    drop(line);
    let mut answer = String::new();
    BufReader::new(stream.take(MAX_LINE as u64))
        .read_line(&mut answer)
        .map_err(|e| format!("read: {:?}", e.kind()))?;
    serde_json::from_str(&answer).map_err(|_| "answer: not understood".to_owned())
}

/// Whether the writer's home is a mount of its own (the encrypted home), not the RAM
/// `/home` it sits on before unlock. The e2e suite's stand-in helper mounts nothing.
fn home_mounted() -> bool {
    use std::os::unix::fs::MetadataExt;
    #[cfg(debug_assertions)]
    if std::env::var_os("BISMILLAH_HELPER_SOCKET").is_some() {
        return true;
    }
    let Some(home) = home() else { return false };
    let device = |p: &std::path::Path| std::fs::metadata(p).map(|m| m.dev()).ok();
    match (device(&home), home.parent().and_then(device)) {
        (Some(home), Some(parent)) => home != parent,
        _ => false,
    }
}

type Start = Box<dyn FnOnce(&AppHandle) -> Result<(), String> + Send>;

/// The startup that waits for home: state, settings, recovery, the dictionary, the
/// library and the watchers (lib.rs).
pub struct Gate {
    start: Mutex<Option<Start>>,
}

impl Gate {
    pub fn new(start: Start) -> Self {
        Self {
            start: Mutex::new(Some(start)),
        }
    }

    fn waiting(&self) -> bool {
        self.start.lock().map(|s| s.is_some()).unwrap_or(false)
    }

    /// Runs the deferred startup, once.
    fn open(&self, app: &AppHandle) -> Result<(), String> {
        let start = self.start.lock().ok().and_then(|mut s| s.take());
        match start {
            Some(start) => start(app),
            None => Ok(()),
        }
    }
}

/// What the page needs to choose its first screen.
#[derive(Serialize)]
pub struct GateState {
    home: Home,
    keyboard: Keyboard,
    /// The session restarted for a keyboard change: reopen without the passphrase.
    resume: bool,
}

/// Home's state while the app waits for it, or null when the app isn't gated (the
/// desktop) or has already started.
#[tauri::command]
pub async fn appliance_gate(app: AppHandle) -> Result<Option<GateState>, String> {
    if !app.try_state::<Gate>().is_some_and(|g| g.waiting()) {
        return Ok(None);
    }
    let answer = tauri::async_runtime::spawn_blocking(|| ask(Request::Status))
        .await
        .map_err(|e| e.to_string())??;
    match answer {
        Answer::Status {
            home,
            keyboard,
            resume,
        } => Ok(Some(GateState {
            home,
            keyboard,
            resume,
        })),
        _ => Err("answer: not a status".to_owned()),
    }
}

/// Sets up, finishes or unlocks home with the passphrase (or, on a session restarted
/// with home open, checks it, or resumes after a keyboard change); on `ok` the app's
/// startup runs. Once the app has started, `verify` is the lock view's check.
#[tauri::command]
pub async fn appliance_open(
    app: AppHandle,
    verb: String,
    passphrase: String,
) -> Result<Answer, String> {
    let passphrase = Secret::new(passphrase);
    tauri::async_runtime::spawn_blocking(move || {
        let gate = app.try_state::<Gate>().ok_or("not gated")?;
        let request = match verb.as_str() {
            "setup" => Request::Setup { passphrase },
            "finish" => Request::Finish { passphrase },
            "unlock" => Request::Unlock { passphrase },
            "verify" => Request::Verify { passphrase },
            "resume" => Request::Resume,
            _ => return Err("unknown verb".to_owned()),
        };
        mark("app-unlock-sent");
        let answer = ask(request)?;
        mark("app-unlock-answered");
        if answer == Answer::Ok {
            // The texts must go to the encrypted home, never to the RAM under it.
            if !home_mounted() {
                return Ok(Answer::Failed {
                    step: "home-not-mounted".into(),
                });
            }
            gate.open(&app)?;
            mark("app-started");
        }
        Ok(answer)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Erases an unfinished setup (Initialising home only), back to a blank stick.
#[tauri::command]
pub async fn appliance_start_over() -> Result<Answer, String> {
    tauri::async_runtime::spawn_blocking(|| ask(Request::StartOver))
        .await
        .map_err(|e| e.to_string())?
}

/// Where a keyboard change leaves the caret for the restarted app: in RAM, an offset
/// and nothing else.
fn caret_file() -> Option<PathBuf> {
    std::env::var_os("XDG_RUNTIME_DIR").map(|dir| PathBuf::from(dir).join("bismillah-caret"))
}

/// Stores the keyboard layouts and, once stored, restarts the session so cage uses
/// them. The page reloads with it, and puts the caret back at `caret`. The page has
/// saved the document first.
#[tauri::command]
pub async fn appliance_set_keyboard(
    layouts: String,
    options: String,
    caret: Option<u32>,
) -> Result<Answer, String> {
    let answer = tauri::async_runtime::spawn_blocking(move || {
        ask(Request::SetKeyboard { layouts, options })
    })
    .await
    .map_err(|e| e.to_string())??;
    if answer == Answer::Ok {
        if let (Some(caret), Some(file)) = (caret, caret_file()) {
            let _ = std::fs::write(file, caret.to_string());
        }
        mark("app-exit-for-keyboard");
        std::process::exit(RESTART_SESSION);
    }
    Ok(answer)
}

/// The caret a keyboard change left, once.
#[tauri::command]
pub fn appliance_take_caret() -> Option<u32> {
    let file = caret_file()?;
    let caret = std::fs::read_to_string(&file).ok()?.trim().parse().ok();
    let _ = std::fs::remove_file(file);
    caret
}

#[tauri::command]
pub async fn appliance_power(action: PowerAction) -> Result<Answer, String> {
    tauri::async_runtime::spawn_blocking(move || ask(Request::Power { action }))
        .await
        .map_err(|e| e.to_string())?
}

/// How guessable a passphrase is, for Setup's meter. The helper checks it again.
#[tauri::command]
pub fn appliance_strength(passphrase: String) -> Strength {
    let passphrase = Secret::new(passphrase);
    passphrase::strength(passphrase.expose())
}

/// A passphrase of six words from the EFF list, chosen with the kernel's randomness.
#[tauri::command]
pub fn appliance_generate() -> Result<String, String> {
    let mut random = std::fs::File::open("/dev/urandom").map_err(|e| format!("{:?}", e.kind()))?;
    let mut failed = false;
    let generated = passphrase::generate(|bytes| failed |= random.read_exact(bytes).is_err());
    if failed {
        return Err("no randomness".to_owned());
    }
    Ok(generated.expose().to_owned())
}

/// An XKB layout or variant the writer can choose, e.g. `se` "Swedish" or
/// `ara(qwerty)` "Arabic (QWERTY)".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Layout {
    id: String,
    name: String,
}

/// Every layout and variant XKB knows, by name.
#[tauri::command]
pub fn appliance_layouts() -> Vec<Layout> {
    let rules = std::fs::read_to_string("/usr/share/X11/xkb/rules/evdev.lst").unwrap_or_default();
    layouts(&rules)
}

fn layouts(rules: &str) -> Vec<Layout> {
    let mut section = "";
    let mut list = Vec::new();
    for line in rules.lines() {
        if let Some(name) = line.strip_prefix("! ") {
            section = name.trim();
            continue;
        }
        let line = line.trim();
        let Some((id, rest)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let rest = rest.trim();
        match section {
            "layout" => list.push(Layout {
                id: id.to_owned(),
                name: rest.to_owned(),
            }),
            // "dvorak          se: Swedish (Dvorak)"
            "variant" => {
                if let Some((layout, name)) = rest.split_once(": ") {
                    list.push(Layout {
                        id: format!("{layout}({id})"),
                        name: name.to_owned(),
                    });
                }
            }
            _ => {}
        }
    }
    list.sort_by_key(|l| l.name.to_lowercase());
    list
}

/// The keyboard indicator: the layouts cage was started with, and what GTK reports.
#[derive(Clone, Serialize)]
pub struct KeyboardState {
    /// In group order.
    layouts: Vec<String>,
    /// The XKB options, e.g. the switch key `grp:alt_shift_toggle`.
    options: String,
    /// The active group, as of the last key press.
    group: u8,
    rtl: bool,
    caps: bool,
}

struct LastKeys(Mutex<crate::platform::KeyState>);

fn keyboard_state(keys: crate::platform::KeyState) -> KeyboardState {
    KeyboardState {
        layouts: std::env::var("XKB_DEFAULT_LAYOUT")
            .unwrap_or_default()
            .split(',')
            .filter(|l| !l.is_empty())
            .map(str::to_owned)
            .collect(),
        options: std::env::var("XKB_DEFAULT_OPTIONS").unwrap_or_default(),
        group: keys.group,
        rtl: keys.rtl,
        caps: keys.caps,
    }
}

/// Starts reporting keyboard changes to the page as `appliance-keyboard` events.
pub fn watch_keyboard(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    app.manage(LastKeys(Mutex::new(Default::default())));
    let handle = app.clone();
    crate::platform::watch_keyboard(&window, move |keys| {
        if let Some(last) = handle.try_state::<LastKeys>()
            && let Ok(mut last) = last.0.lock()
        {
            *last = keys;
        }
        let _ = handle.emit("appliance-keyboard", keyboard_state(keys));
    });
}

#[tauri::command]
pub fn appliance_keyboard(app: AppHandle) -> KeyboardState {
    let keys = app
        .try_state::<LastKeys>()
        .and_then(|l| l.0.lock().ok().map(|k| *k))
        .unwrap_or_default();
    keyboard_state(keys)
}

/// The events connection's writing side, for the page's `painted` report.
#[derive(Default)]
struct Events(Mutex<Option<UnixStream>>);

/// Keeps the events connection to the helper open for as long as the app runs,
/// reconnecting when it drops. On the helper's `lock`, and whenever the connection
/// drops, the page shows the lock view (`appliance-lock`) and reports it painted. While the gate is still up the page
/// already shows Setup or Unlock, so Rust reports it painted itself.
pub fn watch_events(app: &AppHandle) {
    app.manage(Events::default());
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            if let Ok(stream) = connect_events() {
                if let (Some(events), Ok(writer)) = (app.try_state::<Events>(), stream.try_clone())
                    && let Ok(mut slot) = events.0.lock()
                {
                    *slot = Some(writer);
                }
                mark("app-events-connected");
                read_events(&app, stream);
                mark("app-events-lost");
                // The helper now holds the lock up until the passphrase is typed, and
                // can't reach the app to say so: the app locks itself.
                if !app.try_state::<Gate>().is_some_and(|g| g.waiting()) {
                    let _ = app.emit("appliance-lock", ());
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}

fn connect_events() -> std::io::Result<UnixStream> {
    let mut stream = UnixStream::connect(socket())?;
    stream.write_all(&Request::Events.to_line())?;
    Ok(stream)
}

fn read_events(app: &AppHandle, stream: UnixStream) {
    for line in BufReader::new(stream).lines() {
        let Ok(line) = line else { break };
        if let Ok(Event::Lock) = serde_json::from_str(&line) {
            mark("app-lock-asked");
            if app.try_state::<Gate>().is_some_and(|g| g.waiting()) {
                report_painted(app);
            } else {
                let _ = app.emit("appliance-lock", ());
            }
        }
    }
}

fn report_painted(app: &AppHandle) {
    let Some(events) = app.try_state::<Events>() else {
        return;
    };
    let Ok(mut slot) = events.0.lock() else {
        return;
    };
    let mut line = serde_json::to_vec(&Report::Painted).unwrap_or_default();
    line.push(b'\n');
    if slot.as_mut().is_some_and(|s| s.write_all(&line).is_ok()) {
        mark("app-painted");
    }
}

/// The page's lock view is on screen.
#[tauri::command]
pub fn appliance_painted(app: AppHandle) {
    report_painted(&app);
}

/// The battery, for the status line: its charge and whether it is charging. Null on a
/// machine without one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Battery {
    percent: u8,
    charging: bool,
}

/// Where the batteries are: `/sys/class/power_supply`, or a fake folder of the same
/// shape for tests. Debian's kernel has no fake battery (`test_power`) and QEMU no
/// battery device, so the debug image's session and the e2e suite name one here; the
/// release session never sets it.
fn power_supplies() -> PathBuf {
    std::env::var_os("BISMILLAH_POWER_SUPPLY")
        .map_or_else(|| PathBuf::from("/sys/class/power_supply"), PathBuf::from)
}

#[tauri::command]
pub fn appliance_battery() -> Option<Battery> {
    battery(&power_supplies())
}

/// The batteries under `dir` (`/sys/class/power_supply`) as one: their energy summed
/// when they report it, else their mean charge. Charging if any one is, or if mains
/// power is connected and none is discharging.
fn battery(dir: &Path) -> Option<Battery> {
    let read = |path: PathBuf| {
        std::fs::read_to_string(path)
            .map(|s| s.trim().to_owned())
            .ok()
    };
    let mut percents = Vec::new();
    let (mut now, mut full) = (0u64, 0u64);
    let mut energy = true;
    let mut charging = false;
    let mut discharging = false;
    let mut mains = false;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        match read(path.join("type")).as_deref() {
            Some("Battery") => {}
            Some("Mains") => {
                mains |= read(path.join("online")).as_deref() == Some("1");
                continue;
            }
            _ => continue,
        }
        if read(path.join("present")).as_deref() == Some("0") {
            continue;
        }
        let Some(percent) = read(path.join("capacity")).and_then(|c| c.parse::<u8>().ok()) else {
            continue;
        };
        percents.push(percent.min(100));
        match read(path.join("status")).as_deref() {
            Some("Charging") => charging = true,
            Some("Discharging") => discharging = true,
            _ => {}
        }
        let number = |name: &str| read(path.join(name)).and_then(|n| n.parse::<u64>().ok());
        match (number("energy_now"), number("energy_full")) {
            (Some(n), Some(f)) if f > 0 => {
                now += n;
                full += f;
            }
            _ => energy = false,
        }
    }
    if percents.is_empty() {
        return None;
    }
    let percent = if energy && full > 0 {
        (now.saturating_mul(100) / full).min(100) as u8
    } else {
        (percents.iter().map(|&p| u32::from(p)).sum::<u32>() / percents.len() as u32) as u8
    };
    Some(Battery {
        percent,
        charging: charging || (mains && !discharging),
    })
}

/// Lets the page put its own marks next to the helper's and Rust's.
#[tauri::command]
pub fn appliance_mark(name: String) {
    if name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        mark(&format!("page-{name}"));
    }
}

/// Scales each high-density screen to 2x. cage always starts at scale 1, which makes
/// text tiny on a 4K laptop panel. The rule is GNOME's: 2x from 192 dots per inch.
/// Screens that report no physical size (VMs, projectors) stay at 1x.
pub fn scale_outputs() {
    let Ok(listing) = Command::new("wlr-randr").output() else {
        return;
    };
    for output in dense_outputs(&String::from_utf8_lossy(&listing.stdout)) {
        let _ = Command::new("wlr-randr")
            .args(["--output", &output, "--scale", "2"])
            .status();
    }
}

/// The outputs of a `wlr-randr` listing with at least 192 dots per inch.
fn dense_outputs(listing: &str) -> Vec<String> {
    let mut dense = Vec::new();
    let mut output: Option<(String, f64, f64)> = None; // name, width mm, width px
    let mut finish = |o: Option<(String, f64, f64)>| {
        if let Some((name, mm, px)) = o
            && mm > 0.0
            && px * 25.4 / mm >= 192.0
        {
            dense.push(name);
        }
    };
    for line in listing.lines() {
        if !line.starts_with(' ') && !line.is_empty() {
            finish(output.take());
            let name = line.split(' ').next().unwrap_or_default().to_owned();
            output = Some((name, 0.0, 0.0));
            continue;
        }
        let Some((_, mm, px)) = output.as_mut() else {
            continue;
        };
        let line = line.trim();
        if let Some(size) = line.strip_prefix("Physical size:") {
            // "Physical size: 346x194 mm"
            *mm = number_before(size.trim(), 'x');
        } else if line.contains(" px") && line.contains("current") {
            // "3840x2160 px, 60.000000 Hz (preferred, current)"
            *px = number_before(line, 'x');
        }
    }
    finish(output);
    dense
}

fn number_before(text: &str, separator: char) -> f64 {
    text.split(separator)
        .next()
        .and_then(|n| n.trim().parse().ok())
        .unwrap_or(0.0)
}

/// Whether `path` is inside the writer's home (for tests of the fixed folders).
#[cfg(test)]
fn under_home(path: &std::path::Path) -> bool {
    home().is_some_and(|h| path.starts_with(h))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_the_flag_starts_appliance_mode() {
        assert!(enabled(&args(&["bismillah", "--appliance"])));
        assert!(!enabled(&args(&["bismillah"])));
        assert!(!enabled(&args(&["bismillah", "appliance.md"])));
        // The program name itself is never read as the flag.
        assert!(!enabled(&args(&["--appliance"])));
    }

    #[test]
    fn the_apps_own_folders_are_fixed_under_home() {
        let (config, data) = dirs().unwrap();
        assert!(under_home(&config) && config.ends_with(".config/bismillah"));
        assert!(under_home(&data) && data.ends_with(".local/share/bismillah"));
    }

    #[test]
    fn lists_layouts_and_variants_by_name() {
        let rules = "\
! model
  pc105           Generic 105-key PC
! layout
  us              English (US)
  se              Swedish
  ara             Arabic
! variant
  qwerty          ara: Arabic (QWERTY)
! option
  grp:alt_shift_toggle Alt+Shift
";
        let ids: Vec<String> = layouts(rules).into_iter().map(|l| l.id).collect();
        assert_eq!(ids, ["ara", "ara(qwerty)", "us", "se"]);
    }

    fn supply(dir: &Path, name: &str, files: &[(&str, &str)]) {
        let path = dir.join(name);
        std::fs::create_dir_all(&path).unwrap();
        for (file, value) in files {
            std::fs::write(path.join(file), format!("{value}\n")).unwrap();
        }
    }

    #[test]
    fn reads_the_battery() {
        let dir = std::env::temp_dir().join(format!("bismillah-power-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // No battery at all: a desktop or a VM.
        assert_eq!(battery(&dir), None);
        supply(&dir, "AC", &[("type", "Mains"), ("online", "0")]);
        supply(
            &dir,
            "BAT0",
            &[
                ("type", "Battery"),
                ("capacity", "9"),
                ("status", "Discharging"),
            ],
        );
        assert_eq!(
            battery(&dir),
            Some(Battery {
                percent: 9,
                charging: false
            })
        );
        // Two batteries reporting energy are summed by it, not averaged.
        supply(
            &dir,
            "BAT0",
            &[("energy_now", "10000000"), ("energy_full", "50000000")],
        );
        supply(
            &dir,
            "BAT1",
            &[
                ("type", "Battery"),
                ("capacity", "100"),
                ("status", "Full"),
                ("energy_now", "30000000"),
                ("energy_full", "30000000"),
            ],
        );
        assert_eq!(battery(&dir).map(|b| b.percent), Some(50));
        // Plugged in, and neither discharging: charging.
        supply(&dir, "AC", &[("online", "1")]);
        supply(&dir, "BAT0", &[("status", "Not charging")]);
        assert_eq!(battery(&dir).map(|b| b.charging), Some(true));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scales_only_high_density_screens() {
        let listing = "\
eDP-1 \"Sharp Corporation 0x1476 (eDP-1)\"
  Make: Sharp Corporation
  Physical size: 346x194 mm
  Enabled: yes
  Modes:
    3840x2160 px, 60.000000 Hz (preferred, current)
DP-1 \"Dell U2415\"
  Physical size: 518x324 mm
  Modes:
    1920x1200 px, 59.950001 Hz (preferred, current)
    1280x720 px, 60.000000 Hz
Virtual-1 \"QEMU Monitor\"
  Physical size: 0x0 mm
  Modes:
    1280x800 px, 60.000000 Hz (current)
";
        assert_eq!(dense_outputs(listing), vec!["eDP-1".to_owned()]);
        assert!(dense_outputs("").is_empty());
    }
}
