//! Settings in `settings.toml` (ARCHITECTURE.md §9).
//!
//! The file is the writer's: unknown keys, comments and formatting survive every rewrite,
//! an invalid value falls back to its default with a notice, and an unreadable file is
//! kept as a backup while the defaults apply. Nothing here ever crashes the app.

use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use toml_edit::{DocumentMut, Item};

use crate::documents::{self, NO_FAULTS, SaveError};

pub const SCHEMA: i64 = 1;

/// The kind of value a key holds, with its allowed range.
enum Kind {
    Choice(&'static [&'static str]),
    Bool,
    Number {
        min: f64,
        max: f64,
    },
    /// A number, or absent for "the writing profile's default".
    OptionalNumber {
        min: f64,
        max: f64,
    },
    /// A theme file's name without its ending (themes.rs): no folders, not hidden.
    ThemeId,
    /// A font's family name, or "" for none. Free text, but never anything that could
    /// end the CSS string it is set in.
    FontName,
    /// An IANA time zone name (`Europe/Stockholm`), or "" for the system's.
    TimeZone,
}

struct Spec {
    key: &'static str,
    kind: Kind,
    default: fn() -> Value,
}

/// Every setting bismillah reads. Keys are `snake_case` and stable (DESIGN.md §14).
const SPECS: &[Spec] = &[
    Spec {
        key: "theme",
        kind: Kind::Choice(&["system", "light", "dark"]),
        default: || "system".into(),
    },
    Spec {
        key: "colour_theme",
        kind: Kind::ThemeId,
        default: || crate::themes::DEFAULT_ID.into(),
    },
    Spec {
        key: "high_contrast",
        kind: Kind::Bool,
        default: || false.into(),
    },
    Spec {
        key: "writing_profile",
        kind: Kind::Choice(&["duo", "serif", "amiri", "plex-arabic", "custom"]),
        default: || "duo".into(),
    },
    Spec {
        key: "custom_font",
        kind: Kind::FontName,
        default: || "".into(),
    },
    Spec {
        key: "text_scale",
        kind: Kind::Number { min: 0.5, max: 3.0 },
        default: || 1.0.into(),
    },
    Spec {
        key: "measure",
        kind: Kind::Choice(&["narrow", "standard", "wide"]),
        default: || "standard".into(),
    },
    Spec {
        key: "line_height",
        kind: Kind::OptionalNumber { min: 1.2, max: 3.0 },
        default: || Value::Null,
    },
    Spec {
        key: "fade_chrome",
        kind: Kind::Bool,
        default: || true.into(),
    },
    Spec {
        key: "basmallah_opening",
        kind: Kind::Bool,
        default: || true.into(),
    },
    Spec {
        key: "smart_punctuation",
        kind: Kind::Bool,
        default: || true.into(),
    },
    Spec {
        key: "typewriter_scrolling",
        kind: Kind::Bool,
        default: || true.into(),
    },
    Spec {
        key: "always_show_markdown",
        kind: Kind::Bool,
        default: || false.into(),
    },
    Spec {
        key: "focus_mode",
        kind: Kind::Bool,
        default: || false.into(),
    },
    Spec {
        key: "focus_granularity",
        kind: Kind::Choice(&["paragraph", "sentence"]),
        default: || "paragraph".into(),
    },
    Spec {
        key: "focus_dimming",
        kind: Kind::Choice(&["quiet", "faint"]),
        default: || "quiet".into(),
    },
    Spec {
        key: "check_spelling",
        kind: Kind::Bool,
        default: || true.into(),
    },
    Spec {
        key: "check_grammar",
        kind: Kind::Bool,
        default: || true.into(),
    },
    Spec {
        key: "english_dialect",
        kind: Kind::Choice(&["british", "american", "canadian", "australian", "indian"]),
        default: || "british".into(),
    },
    // Chosen in the stick's setup (os/PLAN.md, OS-2); Settings › Time comes in OS-3.
    Spec {
        key: "time_zone",
        kind: Kind::TimeZone,
        default: || "".into(),
    },
];

/// Something the writer should know about their settings file.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Notice {
    /// The file couldn't be read; it was kept under `backup` and the defaults apply.
    Unreadable { backup: String },
    /// These keys had values bismillah can't use; their defaults apply.
    InvalidValues { keys: Vec<String> },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Snapshot {
    pub values: Map<String, Value>,
    pub notices: Vec<Notice>,
}

pub struct Store {
    path: PathBuf,
    document: DocumentMut,
    values: Map<String, Value>,
    notices: Vec<Notice>,
    loaded_mtime: Option<SystemTime>,
}

/// Validates a value for a key, returning it in canonical form.
fn validate(spec: &Spec, value: &Value) -> Option<Value> {
    match (&spec.kind, value) {
        (Kind::Choice(allowed), Value::String(s)) if allowed.contains(&s.as_str()) => {
            Some(value.clone())
        }
        (Kind::Bool, Value::Bool(_)) => Some(value.clone()),
        (Kind::Number { min, max }, Value::Number(n))
        | (Kind::OptionalNumber { min, max }, Value::Number(n)) => {
            let n = n.as_f64()?;
            (n.is_finite() && (*min..=*max).contains(&n)).then(|| n.into())
        }
        (Kind::OptionalNumber { .. }, Value::Null) => Some(Value::Null),
        (Kind::ThemeId, Value::String(s))
            if !s.is_empty()
                && s.len() <= 255
                && !s.starts_with('.')
                && !s.contains(['/', '\\'])
                && !s.chars().any(char::is_control) =>
        {
            Some(value.clone())
        }
        (Kind::FontName, Value::String(s))
            if s.chars().count() <= 100
                && !s.contains(['"', '\\', ';', '{', '}'])
                && !s.chars().any(char::is_control) =>
        {
            Some(s.trim().into())
        }
        (Kind::TimeZone, Value::String(s)) if time_zone_name(s) => Some(s.as_str().into()),
        _ => None,
    }
}

/// An IANA zone's shape: "" or segments of letters, digits, `_`, `+` and `-`.
fn time_zone_name(s: &str) -> bool {
    s.is_empty()
        || (s.len() <= 64
            && s.split('/').all(|part| {
                !part.is_empty()
                    && part != ".."
                    && part
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "_+-".contains(c))
            }))
}

fn from_toml(item: &Item) -> Option<Value> {
    let v = item.as_value()?;
    if let Some(s) = v.as_str() {
        Some(s.into())
    } else if let Some(b) = v.as_bool() {
        Some(b.into())
    } else if let Some(f) = v.as_float() {
        Some(f.into())
    } else {
        v.as_integer().map(|i| (i as f64).into())
    }
}

fn to_toml(value: &Value) -> Option<Item> {
    match value {
        Value::String(s) => Some(toml_edit::value(s.as_str())),
        Value::Bool(b) => Some(toml_edit::value(*b)),
        Value::Number(n) => n.as_f64().map(toml_edit::value),
        _ => None,
    }
}

impl Store {
    /// Loads the settings file, or the defaults when there is none.
    pub fn load(path: PathBuf) -> Self {
        let mut store = Store {
            path,
            document: DocumentMut::new(),
            values: Map::new(),
            notices: Vec::new(),
            loaded_mtime: None,
        };
        store.read();
        store
    }

    fn read(&mut self) {
        self.notices.clear();
        self.loaded_mtime = fs::metadata(&self.path).and_then(|m| m.modified()).ok();
        self.document = match fs::read_to_string(&self.path) {
            Err(_) => DocumentMut::new(),
            Ok(text) => match text.parse::<DocumentMut>() {
                Ok(doc) => doc,
                Err(_) => {
                    let backup = self.keep_unreadable_file();
                    self.notices.push(Notice::Unreadable { backup });
                    DocumentMut::new()
                }
            },
        };
        let mut invalid = Vec::new();
        self.values = SPECS
            .iter()
            .map(|spec| {
                let value = match self.document.get(spec.key) {
                    None => (spec.default)(),
                    Some(item) => match from_toml(item).and_then(|v| validate(spec, &v)) {
                        Some(v) => v,
                        None => {
                            invalid.push(spec.key.to_string());
                            (spec.default)()
                        }
                    },
                };
                (spec.key.to_string(), value)
            })
            .collect();
        if !invalid.is_empty() {
            self.notices.push(Notice::InvalidValues { keys: invalid });
        }
    }

    /// Moves an unreadable file aside so the writer's edits aren't lost when bismillah
    /// next writes its settings. Returns the backup's file name.
    fn keep_unreadable_file(&self) -> String {
        let name = "settings.toml.invalid";
        let backup = self.path.with_file_name(name);
        if let Err(e) = fs::copy(&self.path, &backup) {
            eprintln!(
                "bismillah: couldn't back up the settings file: {:?}",
                e.kind()
            );
        }
        name.into()
    }

    /// One setting's current value (its default when absent or invalid).
    pub fn value(&self, key: &str) -> Option<&Value> {
        self.values.get(key)
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            values: self.values.clone(),
            notices: self.notices.clone(),
        }
    }

    /// Re-reads the file if it changed since it was last read or written (picked up when
    /// the window regains focus, so edits made in another editor apply without polling).
    pub fn reload_if_changed(&mut self) -> Option<Snapshot> {
        let mtime = fs::metadata(&self.path).and_then(|m| m.modified()).ok();
        if mtime == self.loaded_mtime {
            return None;
        }
        self.read();
        Some(self.snapshot())
    }

    /// Applies a change from the UI. Unknown keys and invalid values are rejected whole,
    /// so a bug in the UI can't write a bad file.
    pub fn set(&mut self, patch: &Map<String, Value>) -> Result<Snapshot, SetError> {
        let mut checked = Vec::new();
        for (key, value) in patch {
            let spec = SPECS
                .iter()
                .find(|s| s.key == key)
                .ok_or_else(|| SetError::UnknownKey { key: key.clone() })?;
            let value =
                validate(spec, value).ok_or_else(|| SetError::InvalidValue { key: key.clone() })?;
            checked.push((spec.key, value));
        }
        let had_keys = self.document.iter().count();
        for (key, value) in checked {
            match to_toml(&value) {
                Some(item) => self.document[key] = item,
                None => {
                    self.document.remove(key);
                }
            }
            self.values.insert(key.into(), value);
        }
        if self.document.get("schema").is_none() {
            // A new file starts with its version line; an existing file without one
            // gets it appended, leaving the writer's layout alone.
            if had_keys == 0 {
                let mut doc = DocumentMut::new();
                doc["schema"] = toml_edit::value(SCHEMA);
                for (k, v) in self.document.iter() {
                    doc[k] = v.clone();
                }
                self.document = doc;
            } else {
                self.document["schema"] = toml_edit::value(SCHEMA);
            }
        }
        self.notices
            .retain(|n| !matches!(n, Notice::InvalidValues { .. }));
        self.write().map_err(|error| SetError::NotSaved { error })?;
        Ok(self.snapshot())
    }

    fn write(&mut self) -> Result<(), SaveError> {
        let dir = self.path.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(dir).map_err(|e| SaveError::from_io(&e))?;
        let permissions = fs::metadata(&self.path).ok().map(|m| m.permissions());
        documents::write_atomic(
            &self.path,
            self.document.to_string().as_bytes(),
            permissions,
            NO_FAULTS,
        )
        .map_err(|e| SaveError::from_io(&e))?;
        self.loaded_mtime = fs::metadata(&self.path).and_then(|m| m.modified()).ok();
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SetError {
    #[error("unknown setting {key}")]
    UnknownKey { key: String },
    #[error("invalid value for {key}")]
    InvalidValue { key: String },
    #[error("settings weren't saved: {error}")]
    NotSaved { error: SaveError },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Scratch;
    use serde_json::json;

    fn patch(v: Value) -> Map<String, Value> {
        v.as_object().expect("object").clone()
    }

    #[test]
    fn starts_from_the_defaults_without_creating_a_file() {
        let scratch = Scratch::new();
        let store = Store::load(scratch.path().join("settings.toml"));
        let s = store.snapshot();
        assert_eq!(s.values["theme"], "system");
        assert_eq!(s.values["writing_profile"], "duo");
        assert_eq!(s.values["line_height"], Value::Null);
        assert_eq!(s.values["basmallah_opening"], true);
        assert_eq!(s.values["always_show_markdown"], false);
        assert!(s.notices.is_empty());
        assert!(scratch.entries().is_empty());
    }

    #[test]
    fn keeps_unknown_keys_and_comments_when_rewriting() {
        let scratch = Scratch::new();
        let path = scratch.file(
            "settings.toml",
            b"# my settings\nschema = 1\ntheme = \"dark\" # at night\nfuture_key = [1, 2]\n",
        );
        let mut store = Store::load(path.clone());
        store
            .set(&patch(json!({"measure": "wide", "line_height": 1.9})))
            .unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("# my settings"));
        assert!(text.contains("theme = \"dark\" # at night"));
        assert!(text.contains("future_key = [1, 2]"));
        assert!(text.contains("measure = \"wide\""));
        assert!(text.contains("line_height = 1.9"));
        store.set(&patch(json!({"line_height": null}))).unwrap();
        assert!(!fs::read_to_string(&path).unwrap().contains("line_height"));
    }

    #[test]
    fn writes_the_schema_version_first_in_a_new_file() {
        let scratch = Scratch::new();
        let path = scratch.path().join("conf/settings.toml");
        let mut store = Store::load(path.clone());
        store.set(&patch(json!({"theme": "light"}))).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "schema = 1\ntheme = \"light\"\n"
        );
    }

    #[test]
    fn falls_back_per_key_for_invalid_values() {
        let scratch = Scratch::new();
        let path = scratch.file(
            "settings.toml",
            b"theme = \"purple\"\ntext_scale = 9\nfade_chrome = false\n",
        );
        let store = Store::load(path);
        let s = store.snapshot();
        assert_eq!(s.values["theme"], "system");
        assert_eq!(s.values["text_scale"], 1.0);
        assert_eq!(s.values["fade_chrome"], false);
        assert_eq!(
            s.notices,
            vec![Notice::InvalidValues {
                keys: vec!["theme".into(), "text_scale".into()]
            }]
        );
    }

    #[test]
    fn keeps_an_unreadable_file_and_uses_the_defaults() {
        let scratch = Scratch::new();
        let path = scratch.file("settings.toml", b"theme = \"dark\nbroken");
        let mut store = Store::load(path.clone());
        assert_eq!(store.snapshot().values["theme"], "system");
        assert_eq!(
            store.snapshot().notices,
            vec![Notice::Unreadable {
                backup: "settings.toml.invalid".into()
            }]
        );
        store.set(&patch(json!({"theme": "dark"}))).unwrap();
        assert_eq!(
            fs::read(scratch.path().join("settings.toml.invalid")).unwrap(),
            b"theme = \"dark\nbroken"
        );
    }

    #[test]
    fn rejects_unknown_keys_and_bad_values_from_the_ui() {
        let scratch = Scratch::new();
        let mut store = Store::load(scratch.path().join("settings.toml"));
        assert_eq!(
            store.set(&patch(json!({"nope": 1}))),
            Err(SetError::UnknownKey { key: "nope".into() })
        );
        assert_eq!(
            store.set(&patch(json!({"theme": "dark", "text_scale": "big"}))),
            Err(SetError::InvalidValue {
                key: "text_scale".into()
            })
        );
        assert_eq!(
            store.snapshot().values["theme"],
            "system",
            "nothing applied"
        );
    }

    #[test]
    fn checks_theme_names_and_font_names() {
        let scratch = Scratch::new();
        let mut store = Store::load(scratch.path().join("settings.toml"));
        assert_eq!(store.snapshot().values["colour_theme"], "bismillah");
        assert_eq!(store.snapshot().values["custom_font"], "");
        store
            .set(&patch(
                json!({"colour_theme": "Sepia night", "custom_font": " Noto Serif "}),
            ))
            .unwrap();
        assert_eq!(store.snapshot().values["custom_font"], "Noto Serif");
        for (key, bad) in [
            ("colour_theme", ""),
            ("colour_theme", "../escape"),
            ("colour_theme", ".hidden"),
            ("custom_font", "x\"; color: red"),
            ("custom_font", "a}b"),
        ] {
            assert_eq!(
                store.set(&patch(json!({ key: bad }))),
                Err(SetError::InvalidValue { key: key.into() }),
                "{bad}"
            );
        }
    }

    #[test]
    fn checks_time_zone_names() {
        let scratch = Scratch::new();
        let mut store = Store::load(scratch.path().join("settings.toml"));
        assert_eq!(store.snapshot().values["time_zone"], "");
        for good in [
            "Europe/Stockholm",
            "America/Argentina/Buenos_Aires",
            "Etc/GMT+3",
            "UTC",
            "",
        ] {
            store.set(&patch(json!({ "time_zone": good }))).unwrap();
            assert_eq!(store.snapshot().values["time_zone"], good);
        }
        for bad in [
            "../etc/passwd",
            "/UTC",
            "Europe//Oslo",
            "Asia/Ho Chi Minh",
            "Europe/Stockholm\n",
        ] {
            assert_eq!(
                store.set(&patch(json!({ "time_zone": bad }))),
                Err(SetError::InvalidValue {
                    key: "time_zone".into()
                }),
                "{bad}"
            );
        }
    }

    #[test]
    fn picks_up_edits_made_outside_the_app() {
        let scratch = Scratch::new();
        let path = scratch.file("settings.toml", b"theme = \"light\"\n");
        let mut store = Store::load(path.clone());
        assert_eq!(store.reload_if_changed(), None);
        fs::write(&path, b"theme = \"dark\"\n").unwrap();
        let later = SystemTime::now() + std::time::Duration::from_secs(2);
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();
        let s = store.reload_if_changed().expect("changed");
        assert_eq!(s.values["theme"], "dark");
    }
}
