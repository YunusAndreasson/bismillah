//! The keyboard layouts, kept unencrypted in home's LUKS2 header so cage can use them
//! before unlock (docs/spikes/os-keyboard.md). Before setup has formatted home, the
//! choice waits in RAM.

use bismillah_appliance::protocol::keyboard_names_valid;
use bismillah_appliance::{Keyboard, KeyboardSource};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The LUKS2 token type that holds the layouts.
pub const TOKEN_TYPE: &str = "bismillah-keyboard";
/// Its token slot. The setup state is token 0.
pub const TOKEN_ID: &str = "1";

const PENDING: &str = "/run/bismillah/keyboard.pending";
const ENV: &str = "/run/bismillah/keyboard.env";
const XKB_RULES: &str = "/usr/share/X11/xkb/rules/evdev.lst";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Layouts {
    pub layouts: String,
    pub options: String,
}

impl Layouts {
    /// The token's JSON. It names no keyslot, so it never unlocks anything.
    pub fn token(&self) -> String {
        serde_json::json!({
            "type": TOKEN_TYPE,
            "keyslots": [],
            "layouts": self.layouts,
            "options": self.options,
        })
        .to_string()
    }

    pub fn into_keyboard(self, source: KeyboardSource) -> Keyboard {
        Keyboard {
            layouts: self.layouts,
            options: self.options,
            source,
        }
    }
}

/// Whether XKB knows every layout, variant and option.
pub fn valid(layouts: &str, options: &str) -> bool {
    if !keyboard_names_valid(layouts, options) {
        return false;
    }
    match std::fs::read_to_string(XKB_RULES) {
        Ok(rules) => known(&rules, layouts, options),
        // No rules to check against (a test machine): the names alone.
        Err(_) => true,
    }
}

/// Checks the names against an `evdev.lst` listing.
pub fn known(rules: &str, layouts: &str, options: &str) -> bool {
    let mut section = "";
    let (mut known_layouts, mut known_variants, mut known_options) = (vec![], vec![], vec![]);
    for line in rules.lines() {
        if let Some(name) = line.strip_prefix("! ") {
            section = name.trim();
            continue;
        }
        let mut words = line.split_whitespace();
        let Some(first) = words.next() else { continue };
        match section {
            "layout" => known_layouts.push(first),
            // "  dvorak          se: Swedish (Dvorak)"
            "variant" => {
                if let Some(layout) = words.next().and_then(|w| w.strip_suffix(':')) {
                    known_variants.push((layout, first));
                }
            }
            "option" => known_options.push(first),
            _ => {}
        }
    }
    let layout_ok = |spec: &str| match spec.split_once('(') {
        None => known_layouts.contains(&spec),
        Some((layout, variant)) => variant
            .strip_suffix(')')
            .is_some_and(|v| known_variants.contains(&(layout, v))),
    };
    layouts.split(',').all(layout_ok)
        && (options.is_empty() || options.split(',').all(|o| known_options.contains(&o)))
}

/// The layouts in a LUKS2 header's JSON metadata: `None` with no keyboard token,
/// `Some(Err(()))` for one that can't be used.
pub fn from_metadata(metadata: &serde_json::Value) -> Option<Result<Layouts, ()>> {
    let tokens = metadata.get("tokens")?.as_object()?;
    let token = tokens
        .values()
        .find(|t| t.get("type").and_then(|v| v.as_str()) == Some(TOKEN_TYPE))?;
    let field = |name| token.get(name).and_then(|v| v.as_str()).map(str::to_owned);
    Some(match (field("layouts"), field("options")) {
        (Some(layouts), Some(options)) if valid(&layouts, &options) => {
            Ok(Layouts { layouts, options })
        }
        _ => Err(()),
    })
}

/// The choice made before home was formatted.
pub fn pending() -> Option<Layouts> {
    let text = std::fs::read_to_string(PENDING).ok()?;
    let layouts: Layouts = serde_json::from_str(&text).ok()?;
    valid(&layouts.layouts, &layouts.options).then_some(layouts)
}

pub fn set_pending(layouts: &Layouts) -> std::io::Result<()> {
    write_private(
        Path::new(PENDING),
        &serde_json::to_string(layouts).unwrap_or_default(),
    )
}

pub fn clear_pending() {
    let _ = std::fs::remove_file(PENDING);
}

/// Writes cage's XKB environment for the session (`EnvironmentFile=`). With no usable
/// layouts it is empty, and cage uses its default.
pub fn write_env(keyboard: &Keyboard) -> std::io::Result<()> {
    let usable = matches!(
        keyboard.source,
        KeyboardSource::Token | KeyboardSource::Pending
    ) && keyboard_names_valid(&keyboard.layouts, &keyboard.options);
    let text = if usable {
        format!(
            "XKB_DEFAULT_LAYOUT={}\nXKB_DEFAULT_OPTIONS={}\n",
            keyboard.layouts, keyboard.options
        )
    } else {
        String::new()
    };
    write_private(Path::new(ENV), &text)
}

/// Writes `text` to `path` through a temporary file, root-only.
pub fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let temporary = path.with_extension("new");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&temporary)?;
    file.write_all(text.as_bytes())?;
    std::fs::rename(&temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RULES: &str = "\
! model
  pc105           Generic 105-key PC
! layout
  us              English (US)
  se              Swedish
  ara             Arabic
! variant
  dvorak          se: Swedish (Dvorak)
  qwerty          ara: Arabic (QWERTY)
! option
  grp             Switching to another layout
  grp:alt_shift_toggle Alt+Shift
  caps:escape     Make Caps Lock an additional Esc
";

    #[test]
    fn knows_layouts_variants_and_options() {
        assert!(known(RULES, "se", ""));
        assert!(known(RULES, "se,ara", "grp:alt_shift_toggle"));
        assert!(known(
            RULES,
            "se(dvorak),ara(qwerty)",
            "grp:alt_shift_toggle,caps:escape"
        ));
        assert!(!known(RULES, "fr", ""));
        assert!(!known(RULES, "se(qwerty)", ""));
        assert!(!known(RULES, "se(dvorak", ""));
        assert!(!known(RULES, "se", "grp:win_space_toggle"));
        assert!(!known(RULES, "pc105", ""));
    }

    #[test]
    fn reads_the_token_from_header_metadata() {
        let layouts = Layouts {
            layouts: "se,ara".into(),
            options: "grp:alt_shift_toggle".into(),
        };
        let token: serde_json::Value =
            serde_json::from_str(&layouts.token()).expect("token is JSON");
        assert_eq!(token["keyslots"], serde_json::json!([]));
        let metadata =
            serde_json::json!({ "tokens": { "0": { "type": "bismillah-state" }, "1": token } });
        assert_eq!(from_metadata(&metadata), Some(Ok(layouts)));
        assert_eq!(from_metadata(&serde_json::json!({ "tokens": {} })), None);
        let damaged =
            serde_json::json!({ "tokens": { "1": { "type": TOKEN_TYPE, "layouts": "se\nX=1" } } });
        assert_eq!(from_metadata(&damaged), Some(Err(())));
    }
}
