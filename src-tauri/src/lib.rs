//! bismillah: a calm, offline Markdown editor.
//!
//! Rust owns everything that touches the disk (ARCHITECTURE.md §1): opening and saving
//! documents under the file-safety contract, the library and its path checks, watching
//! for outside changes, the recovery journal, settings, the remembered window, and
//! spelling and grammar (`bismillah-lint`). The frontend owns presentation and editing.

#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "test fixtures should fail immediately"
    )
)]

mod app;
mod appliance;
mod config;
mod documents;
mod images;
mod keybindings;
mod library;
mod lint;
mod platform;
mod recovery;
mod settings;
mod state;
#[cfg(test)]
mod testing;
mod themes;
mod watch;

use serde::Serialize;
use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};

use app::AppState;

/// Shows the native menu bar and focuses its first menu (Alt / F10).
#[tauri::command]
fn menu_reveal(window: tauri::WebviewWindow) -> Result<(), String> {
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            if let Err(e) = platform::reveal_menu(&target) {
                eprintln!("bismillah: couldn't show the menu: {e}");
            }
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn menu_hide(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide_menu().map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct MenuState {
    visible: bool,
    active: bool,
}

/// For the native-menu tests: whether the bar is shown and a menu is selected.
/// Async so it runs off the main thread, which it waits on.
#[tauri::command]
async fn menu_state(window: tauri::WebviewWindow) -> Result<MenuState, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(platform::menu_state(&target));
        })
        .map_err(|e| e.to_string())?;
    let (visible, active) = rx
        .recv()
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(MenuState { visible, active })
}

/// The scheme live preview loads local images from (images.rs). Its URLs are
/// `bismillah-image://localhost/<document id>/<destination as written>`.
const IMAGE_SCHEME: &str = "bismillah-image";

/// Answers one image request: the bytes of a checked image, or an empty "not found".
fn image_response(app: &tauri::AppHandle, path: &str) -> tauri::http::Response<Vec<u8>> {
    let found = images::percent_decode(path.trim_start_matches('/')).and_then(|request| {
        let (id, src) = request.split_once('/')?;
        let state = app.try_state::<AppState>()?;
        state.image(id.parse().ok()?, src).ok()
    });
    let builder = tauri::http::Response::builder()
        .header("Cache-Control", "no-store")
        // An SVG opened on its own could run script; it never may.
        .header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        );
    let response = match found {
        Some((bytes, kind)) => builder.status(200).header("Content-Type", kind).body(bytes),
        None => builder.status(404).body(Vec::new()),
    };
    response.unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

/// Only the app's own origin may load in the webview (ARCHITECTURE.md §10).
fn is_app_origin(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || (cfg!(debug_assertions)
                    && url.host_str() == Some("127.0.0.1")
                    && url.port() == Some(5173))
        }
        _ => false,
    }
}

/// Restores the remembered window size, then shows the window (it starts hidden so it
/// never visibly jumps from the default size).
fn restore_window(window: &tauri::WebviewWindow, state: &AppState) {
    if let Some(saved) = state.memory().window {
        let size = tauri::LogicalSize::new(saved.width.max(480.0), saved.height.max(360.0));
        let _ = window.set_size(size);
        if saved.maximized {
            let _ = window.maximize();
        }
    }
    let _ = window.show();
}

fn remember_window(window: &tauri::Window, state: &AppState) {
    let maximized = window.is_maximized().unwrap_or(false);
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let logical = size.to_logical::<f64>(scale);
    state.remember(|m| {
        let previous = m.window.unwrap_or_default();
        m.window = Some(if maximized {
            // Keep the unmaximised size for when the window is restored.
            state::WindowState {
                maximized,
                ..previous
            }
        } else {
            state::WindowState {
                width: logical.width,
                height: logical.height,
                maximized,
            }
        });
    });
}

struct ConfigWatch(#[allow(dead_code)] std::sync::Mutex<watch::Watch>);

/// Watches the configuration folder, so settings, shortcuts, themes and the dictionary
/// edited in another program apply as soon as they are saved (config.rs). Without a
/// watcher (the folder can't be made, or inotify refuses), they apply on focus instead.
fn watch_config(app: &tauri::AppHandle, dir: &std::path::Path) {
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let handle = app.clone();
    let root = dir.to_path_buf();
    match watch::Watch::start(dir, watch::visible, move |paths| {
        let changed = config::classify(&root, &paths);
        if changed.any() {
            let _ = handle.emit("config-changed", changed);
        }
    }) {
        // Kept for the app's lifetime: dropping it would stop the watching.
        Ok(watch) => {
            app.manage(ConfigWatch(std::sync::Mutex::new(watch)));
        }
        Err(e) => eprintln!("bismillah: not watching the settings folder: {e:?}"),
    }
}

/// What a launch hands to the running app: its working directory and arguments.
#[derive(Serialize, serde::Deserialize)]
struct Launch {
    cwd: std::path::PathBuf,
    args: Vec<String>,
}

pub fn run() {
    appliance::mark("app-process-start");
    let launch = Launch {
        cwd: std::env::current_dir().unwrap_or_default(),
        args: std::env::args().collect(),
    };
    if let Some(answer) = app::cli_answer(&launch.args) {
        println!("{answer}");
        return;
    }
    // First, so a second launch hands its file to the running app and exits before any
    // window exists (ARCHITECTURE.md §12.2).
    let message = serde_json::to_vec(&launch).unwrap_or_default();
    let listener = match platform::claim_instance(platform::instance_socket().as_deref(), &message)
    {
        platform::Instance::Forwarded => return,
        platform::Instance::Primary(listener) => listener,
    };
    let socket = listener
        .as_ref()
        .and_then(platform::InstanceListener::cleanup_path);
    let appliance = appliance::enabled(&launch.args);
    appliance::set_active(appliance);
    let startup = app::cli_path(&launch.args, &launch.cwd);

    let navigation_guard = tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
        .on_navigation(|_webview, url| is_app_origin(url))
        .build();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(navigation_guard)
        .register_asynchronous_uri_scheme_protocol(IMAGE_SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_owned();
            // Off the main thread: a large image is read from disk.
            std::thread::spawn(move || responder.respond(image_response(&app, &path)));
        })
        .invoke_handler(tauri::generate_handler![
            app::app_info,
            app::startup,
            app::doc_open_dialog,
            app::doc_open_guide,
            app::doc_new_dialog,
            app::doc_open_requested,
            app::doc_open_recovered,
            app::doc_save,
            app::doc_save_as,
            app::doc_check,
            app::doc_reload,
            app::recovery_settle,
            app::settings_get,
            app::settings_set,
            app::settings_reload,
            app::themes_list,
            app::font_installed,
            app::keybindings_get,
            app::keybindings_create,
            app::library_get,
            app::library_open_dialog,
            app::library_open_file,
            app::library_new_folder,
            app::library_rename,
            app::library_trash,
            app::library_untrash,
            app::lint_check,
            app::lint_suggest,
            app::lint_add_word,
            app::lint_refresh,
            app::test_open,
            app::test_fault,
            app::test_dialog,
            app::test_library,
            menu_reveal,
            menu_hide,
            menu_state,
            appliance::appliance_gate,
            appliance::appliance_open,
            appliance::appliance_start_over,
            appliance::appliance_set_keyboard,
            appliance::appliance_power,
            appliance::appliance_strength,
            appliance::appliance_generate,
            appliance::appliance_layouts,
            appliance::appliance_keyboard,
            appliance::appliance_mark,
            appliance::appliance_painted,
            appliance::appliance_take_caret,
            appliance::appliance_battery
        ])
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                platform::configure_main_window(&window);
            }
            if appliance {
                appliance::scale_outputs();
                platform::steady_native_caret();
            }
            // Everything that reads the writer's home. On the stick it runs only once
            // the helper has opened home (appliance.rs).
            let begin = move |app: &tauri::AppHandle| -> Result<(), String> {
                let (config_dir, data_dir) = if appliance {
                    appliance::dirs().ok_or("no home folder")?
                } else {
                    app::dirs(app).map_err(|e| e.to_string())?
                };
                // On the stick the library is always ~/Texts.
                let startup = startup.or_else(|| appliance.then(appliance::library).flatten());
                let state = AppState::new(app.clone(), &config_dir, &data_dir, startup);
                if let Some(window) = app.get_webview_window("main") {
                    // cage keeps the stick's window fullscreen: no size to restore.
                    if !appliance {
                        restore_window(&window, &state);
                    }
                }
                app.manage(state);
                AppState::restore_library(app);
                watch_config(app, &config_dir);
                if let Some(listener) = listener {
                    let handle = app.clone();
                    listener.serve(move |message| {
                        let Ok(launch) = serde_json::from_slice::<Launch>(&message) else {
                            return;
                        };
                        if let Some(path) = app::cli_path(&launch.args, &launch.cwd) {
                            handle.state::<AppState>().request_open(&handle, path);
                        }
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    });
                }
                Ok(())
            };
            if appliance {
                if let Some(window) = app.get_webview_window("main") {
                    // Map the dark window first, so the page has its final viewport
                    // before revealing the gate contents.
                    let _ = window.set_fullscreen(true);
                    let _ =
                        window.set_background_color(Some(tauri::window::Color(21, 21, 21, 255)));
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                app.manage(appliance::Gate::new(Box::new(begin)));
                appliance::watch_keyboard(app.handle());
                appliance::watch_events(app.handle());
                return Ok(());
            }
            begin(app.handle()).map_err(Into::into)
        })
        .on_window_event(|window, event| {
            // Absent until the appliance gate has started the app.
            let Some(state) = window.try_state::<AppState>() else {
                return;
            };
            match event {
                // A dropped file opens; a dropped folder becomes the library.
                WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                    let file = paths.iter().find(|p| p.is_file());
                    if let Some(path) = file.or_else(|| paths.iter().find(|p| p.is_dir())) {
                        state.request_open(window.app_handle(), path.clone());
                    }
                }
                WindowEvent::CloseRequested { .. } if !appliance::active() => {
                    remember_window(window, &state)
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("bismillah could not start: {e}");
            std::process::exit(1);
        })
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event
                && let Some(socket) = &socket
            {
                let _ = std::fs::remove_file(socket);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::is_app_origin;
    use crate::app::{cli_answer, cli_path};
    use std::path::{Path, PathBuf};

    fn url(s: &str) -> tauri::Url {
        s.parse().expect("test URLs are valid")
    }

    #[test]
    fn allows_only_the_app_origin() {
        assert!(is_app_origin(&url("tauri://localhost/index.html")));
        assert!(is_app_origin(&url("http://tauri.localhost/")));
    }

    #[test]
    fn refuses_everything_else() {
        for blocked in [
            "https://example.com/",
            "http://localhost:5173/",
            "tauri://evil/",
            "file:///etc/passwd",
            "data:text/html,hi",
            "http://tauri.localhost.example.com/",
        ] {
            assert!(!is_app_origin(&url(blocked)), "{blocked} must be refused");
        }
    }

    #[test]
    fn resolves_command_line_files_against_the_launch_directory() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let cwd = Path::new("/home/writer/notes");
        assert_eq!(
            cli_path(&args(&["bismillah", "letter.md"]), cwd),
            Some(PathBuf::from("/home/writer/notes/letter.md"))
        );
        assert_eq!(
            cli_path(&args(&["bismillah", "/tmp/a.md"]), cwd),
            Some(PathBuf::from("/tmp/a.md"))
        );
        assert_eq!(cli_path(&args(&["bismillah", "--flag"]), cwd), None);
        assert_eq!(cli_path(&args(&["bismillah"]), cwd), None);
    }

    #[test]
    fn answers_help_and_version_in_the_terminal_and_nothing_else() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let version = format!("bismillah {}", env!("CARGO_PKG_VERSION"));
        assert_eq!(
            cli_answer(&args(&["bismillah", "--version"])),
            Some(version.clone())
        );
        assert_eq!(cli_answer(&args(&["bismillah", "-V"])), Some(version));
        let help = cli_answer(&args(&["bismillah", "a.md", "--help"])).unwrap();
        assert!(help.contains("Usage: bismillah [FILE | FOLDER]"), "{help}");
        assert!(
            help.contains("  FOLDER   opens a folder as the library"),
            "{help}"
        );
        assert_eq!(cli_answer(&args(&["bismillah", "-h"])), Some(help));
        // A file and unknown flags start the app.
        assert_eq!(cli_answer(&args(&["bismillah", "letter.md"])), None);
        assert_eq!(cli_answer(&args(&["bismillah", "--flag"])), None);
        assert_eq!(cli_answer(&args(&["bismillah"])), None);
    }
}
