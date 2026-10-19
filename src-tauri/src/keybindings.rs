//! The writer's keyboard shortcuts, in `keybindings.toml` (ARCHITECTURE.md §9,
//! DESIGN.md §13).
//!
//! Rust reads the file and hands over its lines; the frontend checks each one against
//! the command registry, which it owns (`src/core/keybindings.svelte.ts`). bismillah
//! writes this file only when the writer asks for a starting one, and never replaces it.

use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::documents::{self, NO_FAULTS, SaveError};

/// A real file is a few KiB; anything far larger isn't read.
const MAX_BYTES: u64 = 256 * 1024;

/// One line of the file: a command and the shortcut given for it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Entry {
    /// The command's id (`editor.toggleFocus`), however the file wrote it: quoted,
    /// dotted, or under a `[editor]` table.
    pub command: String,
    /// The text given; `None` when it isn't text (a number, a list).
    pub shortcut: Option<String>,
    pub line: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Unreadable {
    /// Not valid TOML; `line` where the parser stopped.
    Syntax {
        line: Option<usize>,
    },
    TooLarge,
    /// The file exists but couldn't be read (permissions, not UTF-8).
    Io,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Keybindings {
    pub exists: bool,
    pub entries: Vec<Entry>,
    /// Set when the file couldn't be read: every command keeps its own shortcut.
    pub unreadable: Option<Unreadable>,
}

fn line_at(text: &str, offset: usize) -> usize {
    text.get(..offset).map_or(0, |s| s.matches('\n').count()) + 1
}

/// Flattens nested tables into dotted ids, so `"file.save" = …`, `file.save = …` and
/// `[file]` `save = …` all name the same command.
fn collect(text: &str, prefix: &str, table: &toml_edit::Table, out: &mut Vec<Entry>) {
    for (key, item) in table.iter() {
        let id = if prefix.is_empty() {
            key.to_string()
        } else {
            format!("{prefix}.{key}")
        };
        let line = table
            .key(key)
            .and_then(|k| k.span())
            .or_else(|| item.span())
            .map_or(0, |s| line_at(text, s.start));
        match item {
            toml_edit::Item::Table(inner) => collect(text, &id, inner, out),
            toml_edit::Item::Value(toml_edit::Value::InlineTable(inner)) => {
                collect(text, &id, &inner.clone().into_table(), out)
            }
            // The version line isn't a command.
            _ if id == "schema" => {}
            toml_edit::Item::Value(value) => out.push(Entry {
                command: id,
                shortcut: value.as_str().map(str::to_owned),
                line,
            }),
            _ => out.push(Entry {
                command: id,
                shortcut: None,
                line,
            }),
        }
    }
}

/// Reads `keybindings.toml`; a missing file is no file, not a problem.
pub fn read(path: &Path) -> Keybindings {
    let none = |exists, unreadable| Keybindings {
        exists,
        entries: Vec::new(),
        unreadable,
    };
    let size = match fs::metadata(path) {
        Err(_) => return none(false, None),
        Ok(m) => m.len(),
    };
    if size > MAX_BYTES {
        return none(true, Some(Unreadable::TooLarge));
    }
    let Ok(text) = fs::read_to_string(path) else {
        return none(true, Some(Unreadable::Io));
    };
    match toml_edit::Document::parse(text.as_str()) {
        Err(e) => none(
            true,
            Some(Unreadable::Syntax {
                line: e.span().map(|s| line_at(&text, s.start)),
            }),
        ),
        Ok(doc) => {
            let mut entries = Vec::new();
            collect(&text, "", doc.as_table(), &mut entries);
            Keybindings {
                exists: true,
                entries,
                unreadable: None,
            }
        }
    }
}

/// Writes a starting file (the frontend lists every command in it), only if there is
/// none: an existing file is the writer's and is never replaced.
pub fn create(path: &Path, text: &str) -> Result<Keybindings, SaveError> {
    if text.len() as u64 > MAX_BYTES {
        return Err(SaveError::Other {
            detail: "too large".into(),
        });
    }
    if fs::symlink_metadata(path).is_ok() {
        return Err(SaveError::Exists);
    }
    let dir = path.parent().ok_or(SaveError::Unavailable)?;
    fs::create_dir_all(dir).map_err(|e| SaveError::from_io(&e))?;
    documents::write_atomic(path, text.as_bytes(), None, NO_FAULTS)
        .map_err(|e| SaveError::from_io(&e))?;
    Ok(read(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Scratch;

    fn entry(command: &str, shortcut: Option<&str>, line: usize) -> Entry {
        Entry {
            command: command.into(),
            shortcut: shortcut.map(str::to_owned),
            line,
        }
    }

    #[test]
    fn a_missing_file_is_no_file() {
        let scratch = Scratch::new();
        let k = read(&scratch.path().join("keybindings.toml"));
        assert_eq!(
            k,
            Keybindings {
                exists: false,
                entries: vec![],
                unreadable: None
            }
        );
    }

    #[test]
    fn reads_quoted_dotted_and_table_forms_alike() {
        let scratch = Scratch::new();
        let path = scratch.file(
            "keybindings.toml",
            b"# mine\nschema = 1\n\"editor.toggleFocus\" = \"Ctrl+Shift+D\"\n\
              view.fullscreen = \"\"\nfile.save = 5\n\n[check]\nnext = \"F8\"\n\
              inline = { a = \"F9\" }\n",
        );
        let k = read(&path);
        assert!(k.exists);
        assert_eq!(k.unreadable, None);
        assert_eq!(
            k.entries,
            vec![
                entry("editor.toggleFocus", Some("Ctrl+Shift+D"), 3),
                entry("view.fullscreen", Some(""), 4),
                entry("file.save", None, 5),
                entry("check.next", Some("F8"), 8),
                entry("check.inline.a", Some("F9"), 9),
            ]
        );
    }

    #[test]
    fn says_where_the_file_stops_being_toml() {
        let scratch = Scratch::new();
        let path = scratch.file("keybindings.toml", b"\"file.save\" = \"Ctrl+S\"\noops\n");
        let k = read(&path);
        assert_eq!(k.unreadable, Some(Unreadable::Syntax { line: Some(2) }));
        assert!(k.entries.is_empty());
        let big = scratch.file("big.toml", &vec![b'#'; MAX_BYTES as usize + 1]);
        assert_eq!(read(&big).unreadable, Some(Unreadable::TooLarge));
        let latin1 = scratch.file("latin1.toml", b"# caf\xe9\n");
        assert_eq!(read(&latin1).unreadable, Some(Unreadable::Io));
    }

    #[test]
    fn creates_a_starting_file_but_never_replaces_one() {
        let scratch = Scratch::new();
        let path = scratch.path().join("conf/keybindings.toml");
        let k = create(&path, "# start\nschema = 1\n").unwrap();
        assert!(k.exists);
        assert_eq!(fs::read_to_string(&path).unwrap(), "# start\nschema = 1\n");
        assert_eq!(create(&path, "other"), Err(SaveError::Exists));
        assert_eq!(fs::read_to_string(&path).unwrap(), "# start\nschema = 1\n");
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_create_says_why_and_leaves_nothing() {
        use std::os::unix::fs::PermissionsExt;
        let scratch = Scratch::new();
        let dir = scratch.path().join("locked");
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
        let result = create(&dir.join("keybindings.toml"), "x");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        // Root may write anyway (the offline run maps us to root in its namespace).
        if result.is_ok() {
            return;
        }
        assert_eq!(result, Err(SaveError::PermissionDenied));
        assert!(fs::read_dir(&dir).unwrap().next().is_none());
    }
}
