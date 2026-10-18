//! All platform-specific code lives here (ARCHITECTURE.md §12.3).

/// Per-platform window setup after the main window is created.
pub fn configure_main_window(_window: &tauri::WebviewWindow) {}

/// Shows the menu bar and puts keyboard focus on its first menu (Alt / F10 on Linux and
/// Windows). It hides itself again when it closes.
pub fn reveal_menu(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.show_menu()?;
    #[cfg(target_os = "linux")]
    linux::focus_menu_bar(window);
    Ok(())
}

/// Whether the menu bar is shown, and whether one of its menus is open or selected.
pub fn menu_state(window: &tauri::WebviewWindow) -> tauri::Result<(bool, bool)> {
    let visible = window.is_menu_visible()?;
    #[cfg(target_os = "linux")]
    let active = linux::menu_bar_active(window);
    #[cfg(not(target_os = "linux"))]
    let active = false;
    Ok((visible, active))
}

#[cfg(target_os = "linux")]
mod linux {
    use gtk::prelude::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    static HIDE_ON_CLOSE: AtomicBool = AtomicBool::new(false);

    fn menu_bar(window: &tauri::WebviewWindow) -> Option<gtk::MenuBar> {
        let vbox = window.default_vbox().ok()?;
        vbox.children()
            .into_iter()
            .find_map(|w| w.downcast::<gtk::MenuBar>().ok())
    }

    pub fn focus_menu_bar(window: &tauri::WebviewWindow) {
        let Some(bar) = menu_bar(window) else { return };
        if !HIDE_ON_CLOSE.swap(true, Ordering::SeqCst) {
            let window = window.clone();
            bar.connect_deactivate(move |_| {
                // Closing the menu (Esc, a choice, a click elsewhere) hides the bar again.
                let _ = window.hide_menu();
            });
        }
        bar.select_first(true);
    }

    pub fn menu_bar_active(window: &tauri::WebviewWindow) -> bool {
        menu_bar(window).is_some_and(|bar| bar.selected_item().is_some())
    }
}
