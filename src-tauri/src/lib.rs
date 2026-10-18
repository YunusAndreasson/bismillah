//! bismillah: Phase 0 spike app.
//!
//! This is the harness the Phase 0 spikes run in (PLAN.md): it opens one document
//! read-only in the editor so typography, bidi, hanging marks and the Basmallah can be
//! checked in the real webview. Saving, the library and settings arrive in Phase 1.

mod platform;

use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

/// The bundled specimen, shown when no file is given on the command line.
const SPECIMEN: &str = include_str!("../../docs/specimen.md");

#[derive(Clone, Serialize)]
struct InitialDocument {
    /// File name shown in the title, never a full path.
    name: String,
    text: String,
}

#[derive(Serialize)]
struct AppInfo {
    /// Set by the test harness (`BISMILLAH_TEST=1`) so the frontend exposes its
    /// test hooks and disables caret blinking for deterministic screenshots.
    test_mode: bool,
}

struct AppState {
    document: Result<InitialDocument, String>,
}

/// Reads the document named on the command line. The path comes from the writer
/// (the shell), never from the frontend.
fn load_initial_document() -> Result<InitialDocument, String> {
    let Some(arg) = std::env::args_os().nth(1) else {
        return Ok(InitialDocument {
            name: "specimen.md".into(),
            text: SPECIMEN.into(),
        });
    };
    let path = PathBuf::from(arg);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "untitled".into());
    let bytes =
        std::fs::read(&path).map_err(|e| format!("Couldn't open \"{name}\": {}", e.kind()))?;
    let text = String::from_utf8(bytes)
        .map_err(|_| format!("Couldn't open \"{name}\": it isn't UTF-8 text"))?;
    Ok(InitialDocument { name, text })
}

#[tauri::command]
fn initial_document(state: tauri::State<'_, AppState>) -> Result<InitialDocument, String> {
    state.document.clone()
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        test_mode: std::env::var_os("BISMILLAH_TEST").is_some(),
    }
}

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

/// For the native-menu spike tests: whether the bar is shown and a menu is selected.
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

pub fn run() {
    let navigation_guard = tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
        .on_navigation(|_webview, url| is_app_origin(url))
        .build();

    tauri::Builder::default()
        .plugin(navigation_guard)
        .manage(AppState {
            document: load_initial_document(),
        })
        .invoke_handler(tauri::generate_handler![
            initial_document,
            app_info,
            menu_reveal,
            menu_hide,
            menu_state
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                platform::configure_main_window(&window);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("bismillah could not start: {e}");
            std::process::exit(1);
        });
}

#[cfg(test)]
mod tests {
    use super::is_app_origin;

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
}
