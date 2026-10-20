//! OS-0 spike "Keyboard" (os/PLAN.md). Not product code.
//!
//! cage takes its layouts from `XKB_DEFAULT_LAYOUT`/`XKB_DEFAULT_OPTIONS`, which the
//! session reads from the LUKS2 token before unlock. A change is stored by the helper
//! and applied by restarting the session (exit 76): cage has no runtime keymap IPC.
//! The indicator reads GTK: the layout group from each key event, and the direction
//! and Caps Lock from the keymap, which updates on every modifier or group change.

use crate::spike_unlock::{Gate, ask, mark};
use gtk::gdk;
use gtk::prelude::*;
use serde::Serialize;
use std::sync::atomic::{AtomicU8, Ordering};
use tauri::{AppHandle, Emitter, Manager};

/// Exit code that asks systemd to restart the session, so cage reads the new layouts.
const RESTART_SESSION: i32 = 76;

#[derive(Clone, Serialize)]
pub struct KeyboardState {
    /// The layouts cage was started with, in group order.
    layouts: Vec<String>,
    options: String,
    /// The active group, as of the last key press.
    group: u8,
    rtl: bool,
    caps: bool,
}

struct Group(AtomicU8);

fn keymap() -> Option<gdk::Keymap> {
    gdk::Display::default().and_then(|d| gdk::Keymap::for_display(&d))
}

fn state(app: &AppHandle) -> KeyboardState {
    let env = |name| std::env::var(name).unwrap_or_default();
    let keymap = keymap();
    KeyboardState {
        layouts: env("XKB_DEFAULT_LAYOUT")
            .split(',')
            .filter(|l| !l.is_empty())
            .map(str::to_owned)
            .collect(),
        options: env("XKB_DEFAULT_OPTIONS"),
        group: app
            .try_state::<Group>()
            .map_or(0, |g| g.0.load(Ordering::Relaxed)),
        rtl: keymap
            .as_ref()
            .is_some_and(|k| k.direction() == gtk::pango::Direction::Rtl),
        caps: keymap.as_ref().is_some_and(gdk::Keymap::is_caps_locked),
    }
}

/// Starts reporting keyboard changes to the page as `spike-keyboard` events.
pub fn watch(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(toplevel) = window.gtk_window() else {
        return;
    };
    app.manage(Group(AtomicU8::new(0)));
    let handle = app.clone();
    // The toplevel sees each key before WebKit does.
    toplevel.connect_key_press_event(move |_, event| {
        if let Some(group) = handle.try_state::<Group>() {
            group.0.store(event.group(), Ordering::Relaxed);
        }
        // Spike diagnostics: the group only, never which key.
        mark(&format!("key-group-{}", event.group()));
        let _ = handle.emit("spike-keyboard", state(&handle));
        gtk::glib::Propagation::Proceed
    });
    if let Some(keymap) = keymap() {
        let handle = app.clone();
        keymap.connect_state_changed(move |_| {
            let _ = handle.emit("spike-keyboard", state(&handle));
        });
    }
}

#[tauri::command]
pub fn spike_keyboard(app: AppHandle) -> KeyboardState {
    state(&app)
}

/// Stores the layouts with the helper, then restarts the session to apply them.
#[tauri::command]
pub fn spike_set_keyboard(
    app: AppHandle,
    layouts: String,
    options: String,
) -> Result<String, String> {
    let valid = |s: &str| {
        s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "_,:()-".contains(c))
    };
    if layouts.is_empty() || !valid(&layouts) || !valid(&options) {
        return Ok("invalid".to_owned());
    }
    let gate = app.try_state::<Gate>().ok_or("not gated")?;
    let answer = ask(
        gate.socket(),
        &["set_keyboard", &format!("{layouts} {options}")],
    )?;
    if answer == "ok" {
        mark("app-exit-for-keyboard");
        std::process::exit(RESTART_SESSION);
    }
    Ok(answer)
}

/// The suspend lock's check: the helper tests the passphrase against home's keyslot.
#[tauri::command]
pub async fn spike_verify(app: AppHandle, passphrase: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let gate = app.try_state::<Gate>().ok_or("not gated")?;
        mark("app-verify-sent");
        let answer = ask(gate.socket(), &["verify", &passphrase]);
        mark("app-verify-answered");
        answer
    })
    .await
    .map_err(|e| e.to_string())?
}
