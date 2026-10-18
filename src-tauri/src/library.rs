//! The library: the folder of writing the writer chose (ARCHITECTURE.md §6).
//!
//! The frontend names entries by their path relative to the library root, `/`-separated.
//! Every such path is checked here before anything touches the disk: it must be made of
//! plain names (no `..`, no absolute paths), and once symlinks are resolved it must still
//! lie inside the root. A link that leads outside the root is listed but can't be opened.
//! The frontend asks; Rust decides (AGENTS.md, "The writer's trust" rule 5).

use icu_normalizer::DecomposingNormalizerBorrowed;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Component, Path, PathBuf};

use crate::documents;
use crate::platform;

/// Bounds on what a listing reads, so a mistaken choice of folder (a home directory, a
/// whole disk) stays responsive.
const MAX_ENTRIES: usize = 20_000;
const MAX_DEPTH: usize = 64;
/// The longest name most file systems accept, in bytes.
const MAX_NAME_BYTES: usize = 255;

/// Why a library action was refused or failed. Carries no paths or document text, so it
/// can be logged; the UI explains it in plain words (DESIGN.md §14).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LibraryError {
    #[error("the path leads outside the library")]
    Outside,
    #[error("the path isn't a plain path inside the library")]
    InvalidPath,
    #[error("the name isn't usable ({reason:?})")]
    InvalidName { reason: NameProblem },
    #[error("there's nothing at that path")]
    NotFound,
    #[error("something with that name already exists")]
    Exists,
    #[error("permission denied")]
    PermissionDenied,
    #[error("the volume is read-only")]
    ReadOnlyVolume,
    #[error("the disk is full")]
    DiskFull,
    #[error("the library folder is unavailable")]
    Unavailable,
    #[error("input/output error ({detail})")]
    Other { detail: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NameProblem {
    Empty,
    /// Contains `/`, which separates folders.
    Slash,
    /// Starts with a dot: such names are hidden, so the entry would vanish from view.
    Dot,
    TooLong,
    /// Contains a control character, which can't be seen or typed reliably.
    Control,
}

impl LibraryError {
    /// Classifies an I/O error. Only the error kind is kept, never a path.
    pub fn from_io(e: &io::Error) -> Self {
        match e.kind() {
            ErrorKind::NotFound => LibraryError::NotFound,
            ErrorKind::AlreadyExists | ErrorKind::DirectoryNotEmpty => LibraryError::Exists,
            ErrorKind::PermissionDenied => LibraryError::PermissionDenied,
            ErrorKind::ReadOnlyFilesystem => LibraryError::ReadOnlyVolume,
            ErrorKind::StorageFull | ErrorKind::QuotaExceeded => LibraryError::DiskFull,
            ErrorKind::InvalidFilename => LibraryError::InvalidName {
                reason: NameProblem::TooLong,
            },
            kind => LibraryError::Other {
                detail: format!("{kind:?}"),
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Folder,
    File,
}

/// One entry of the listing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Node {
    pub name: String,
    /// Relative to the library root, `/`-separated.
    pub path: String,
    pub kind: NodeKind,
    /// A link that leads outside the library, or round in a loop: listed so the writer
    /// sees it, but never opened or listed into.
    pub unavailable: bool,
    /// Folders only: folders first, then files, each in natural order.
    pub children: Vec<Node>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Tree {
    pub nodes: Vec<Node>,
    /// The listing stopped at `MAX_ENTRIES` entries or `MAX_DEPTH` levels.
    pub truncated: bool,
}

/// Whether a file name is one the library lists as a document (`.md`, `.markdown`).
pub fn is_markdown(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
}

/// Checks a name the writer typed for a new or renamed entry. Spaces, Arabic and every
/// other printable character are fine; the name is used exactly as typed.
pub fn validate_name(name: &str) -> Result<(), LibraryError> {
    let problem = if name.is_empty() {
        Some(NameProblem::Empty)
    } else if name.contains('/') {
        Some(NameProblem::Slash)
    } else if name.starts_with('.') {
        Some(NameProblem::Dot)
    } else if name.len() > MAX_NAME_BYTES {
        Some(NameProblem::TooLong)
    } else if name.chars().any(char::is_control) {
        Some(NameProblem::Control)
    } else {
        None
    };
    match problem {
        Some(reason) => Err(LibraryError::InvalidName { reason }),
        None => Ok(()),
    }
}

/// A digit's value, for natural ordering: ASCII, Arabic-Indic and Extended Arabic-Indic
/// digits all count, so "باب ٢" sorts before "باب ١٠" just as "Chapter 2" sorts before
/// "Chapter 10".
fn digit(c: char) -> Option<u8> {
    let value = match c {
        '0'..='9' => u32::from(c) - u32::from('0'),
        '\u{660}'..='\u{669}' => u32::from(c) - 0x660,
        '\u{6F0}'..='\u{6F9}' => u32::from(c) - 0x6F0,
        _ => return None,
    };
    u8::try_from(value).ok()
}

/// Combining marks: Latin diacritics (after decomposition) and Arabic vocalisation and
/// Qur'anic annotation marks.
fn is_mark(c: char) -> bool {
    matches!(c,
        '\u{300}'..='\u{36F}'
        | '\u{1AB0}'..='\u{1AFF}'
        | '\u{1DC0}'..='\u{1DFF}'
        | '\u{20D0}'..='\u{20FF}'
        | '\u{FE20}'..='\u{FE2F}'
        | '\u{610}'..='\u{61A}'
        | '\u{64B}'..='\u{65F}'
        | '\u{670}'
        | '\u{6D6}'..='\u{6ED}'
        | '\u{8D3}'..='\u{8FF}')
}

/// The text a name sorts by: decomposed, without marks, lower case, and without the
/// IJMES ʿ and ʾ, apostrophes and tatweel, so "ʿIlm" sorts under I and "Ḥadīth" under H,
/// as they would in a catalogue. A copy for comparing only; names are never changed.
fn sort_key(name: &str) -> String {
    const SKIPPED: [char; 6] = [
        '\u{2BF}', '\u{2BE}', '\u{2BB}', '\u{2018}', '\u{2019}', '\u{640}',
    ];
    let decomposed = DecomposingNormalizerBorrowed::new_nfd().normalize(name);
    decomposed
        .chars()
        .filter(|&c| !is_mark(c) && !SKIPPED.contains(&c) && c != '\'')
        .map(|c| if c == '\u{671}' { '\u{627}' } else { c })
        .flat_map(char::to_lowercase)
        .collect()
}

/// Natural order (the 2026-10-18 interview): numbers compare by value, letters by their
/// sort key (`sort_key`). Names equal under those rules fall back to their exact text,
/// so the order is total and stable.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (ka, kb) = (sort_key(a), sort_key(b));
    let (mut x, mut y) = (ka.chars().peekable(), kb.chars().peekable());
    loop {
        let (Some(&c), Some(&d)) = (x.peek(), y.peek()) else {
            return match (x.peek(), y.peek()) {
                (None, None) => a.cmp(b),
                (None, Some(_)) => Ordering::Less,
                _ => Ordering::Greater,
            };
        };
        if digit(c).is_some() && digit(d).is_some() {
            let take = |it: &mut std::iter::Peekable<std::str::Chars<'_>>| {
                let mut digits = Vec::new();
                while let Some(v) = it.peek().copied().and_then(digit) {
                    digits.push(v);
                    it.next();
                }
                let first = digits.iter().position(|&v| v != 0).unwrap_or(digits.len());
                digits.split_off(first)
            };
            let (m, n) = (take(&mut x), take(&mut y));
            match m.len().cmp(&n.len()).then_with(|| m.cmp(&n)) {
                Ordering::Equal => continue,
                other => return other,
            }
        }
        match c.cmp(&d) {
            Ordering::Equal => {
                x.next();
                y.next();
            }
            other => return other,
        }
    }
}

fn sort(nodes: &mut [Node]) {
    nodes.sort_by(|a, b| {
        let folder = |n: &Node| n.kind != NodeKind::Folder;
        folder(a)
            .cmp(&folder(b))
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
}

/// Splits a relative library path into its names. The empty string is the root itself.
fn names(rel: &str) -> Result<Vec<&str>, LibraryError> {
    if rel.is_empty() {
        return Ok(Vec::new());
    }
    let parts: Vec<&str> = rel.split('/').collect();
    for part in &parts {
        // Only plain names: no empty parts ("a//b", a leading "/"), no "." or "..".
        let plain = !part.is_empty()
            && !part.contains('\0')
            && matches!(
                Path::new(part).components().next(),
                Some(Component::Normal(_))
            )
            && Path::new(part).components().count() == 1;
        if !plain || *part == "." || *part == ".." {
            return Err(LibraryError::InvalidPath);
        }
    }
    Ok(parts)
}

fn join(rel: &str, name: &str) -> String {
    if rel.is_empty() {
        name.to_string()
    } else {
        format!("{rel}/{name}")
    }
}

/// The library folder, canonicalised when chosen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Library {
    root: PathBuf,
}

impl Library {
    /// Opens a folder as the library. The root is stored with symlinks resolved, so
    /// every later check compares like with like.
    pub fn open(path: &Path) -> Result<Self, LibraryError> {
        let root = fs::canonicalize(path).map_err(|e| match e.kind() {
            ErrorKind::NotFound => LibraryError::Unavailable,
            _ => LibraryError::from_io(&e),
        })?;
        if !root.is_dir() {
            return Err(LibraryError::InvalidPath);
        }
        Ok(Library { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The folder's own name, shown at the top of the library.
    pub fn name(&self) -> String {
        documents::display_name(&self.root)
    }

    pub fn contains(&self, path: &Path) -> bool {
        path.starts_with(&self.root)
    }

    /// A canonical path's place in the library (`None` outside it, or for names that
    /// aren't UTF-8, which the library doesn't list).
    pub fn relative(&self, path: &Path) -> Option<String> {
        let rest = path.strip_prefix(&self.root).ok()?;
        let parts: Option<Vec<&str>> = rest.iter().map(|p| p.to_str()).collect();
        Some(parts?.join("/"))
    }

    /// Resolves `rel`, following symlinks, to a path that exists inside the library:
    /// what is opened or listed into.
    pub fn resolve(&self, rel: &str) -> Result<PathBuf, LibraryError> {
        let mut path = self.root.clone();
        path.extend(names(rel)?);
        let real = fs::canonicalize(&path).map_err(|e| LibraryError::from_io(&e))?;
        if !self.contains(&real) {
            return Err(LibraryError::Outside);
        }
        Ok(real)
    }

    /// Resolves a folder inside the library (the root for "").
    pub fn folder(&self, rel: &str) -> Result<PathBuf, LibraryError> {
        let dir = self.resolve(rel)?;
        if !dir.is_dir() {
            return Err(LibraryError::InvalidPath);
        }
        Ok(dir)
    }

    /// Resolves `rel` to the entry itself: its folder is resolved and checked, but a
    /// link at the end is not followed. Renaming or trashing a link acts on the link,
    /// never on what it points to.
    pub fn entry(&self, rel: &str) -> Result<PathBuf, LibraryError> {
        let parts = names(rel)?;
        let Some((name, parents)) = parts.split_last() else {
            // The root itself is never renamed or trashed from inside the library.
            return Err(LibraryError::InvalidPath);
        };
        let path = self.folder(&parents.join("/"))?.join(name);
        fs::symlink_metadata(&path).map_err(|e| LibraryError::from_io(&e))?;
        Ok(path)
    }

    /// Lists the library: folders and Markdown files, hidden names left out.
    pub fn tree(&self) -> Result<Tree, LibraryError> {
        if !self.root.is_dir() {
            return Err(LibraryError::Unavailable);
        }
        let mut walk = Walk {
            library: self,
            left: MAX_ENTRIES,
            truncated: false,
            ancestors: HashSet::from([self.root.clone()]),
        };
        let nodes = walk.folder(&self.root, "", 0);
        Ok(Tree {
            nodes,
            truncated: walk.truncated,
        })
    }

    /// Creates an empty folder. Never replaces anything.
    pub fn create_folder(&self, parent: &str, name: &str) -> Result<String, LibraryError> {
        validate_name(name)?;
        let dir = self.folder(parent)?;
        fs::create_dir(dir.join(name)).map_err(|e| LibraryError::from_io(&e))?;
        platform::sync_dir(&dir).map_err(|e| LibraryError::from_io(&e))?;
        Ok(join(parent, name))
    }

    /// Renames an entry within its folder. Refuses to replace anything that exists.
    /// A file keeps being a Markdown document: a name without `.md` or `.markdown`
    /// gets `.md`. Returns the old and new paths on disk and the new relative path.
    pub fn rename(&self, rel: &str, name: &str) -> Result<Renamed, LibraryError> {
        validate_name(name)?;
        let from = self.entry(rel)?;
        let is_file = !fs::metadata(&from).is_ok_and(|m| m.is_dir());
        let name = if is_file && !is_markdown(name) {
            format!("{name}.md")
        } else {
            name.to_string()
        };
        validate_name(&name)?;
        let dir = from
            .parent()
            .ok_or(LibraryError::InvalidPath)?
            .to_path_buf();
        let to = dir.join(&name);
        if to != from {
            platform::rename_no_replace(&from, &to).map_err(|e| LibraryError::from_io(&e))?;
            platform::sync_dir(&dir).map_err(|e| LibraryError::from_io(&e))?;
        }
        let parent = rel.rsplit_once('/').map_or("", |(p, _)| p);
        Ok(Renamed {
            from,
            to,
            path: join(parent, &name),
        })
    }

    /// Moves an entry to the system trash (ARCHITECTURE.md §5.8).
    pub fn trash(&self, rel: &str, trash: &dyn Trash) -> Result<PathBuf, LibraryError> {
        let path = self.entry(rel)?;
        trash.trash(&path)?;
        Ok(path)
    }
}

/// A rename that happened: where the entry was and is on disk, and its new place in
/// the library.
#[derive(Debug, PartialEq, Eq)]
pub struct Renamed {
    pub from: PathBuf,
    pub to: PathBuf,
    pub path: String,
}

/// The system trash, behind a trait so tests never touch the writer's real one.
pub trait Trash: Send + Sync {
    fn trash(&self, path: &Path) -> Result<(), LibraryError>;
    /// Puts back the newest item trashed from `path` at or after `since_s` (seconds
    /// since the Unix epoch). Refuses if something now exists at `path`.
    fn restore(&self, path: &Path, since_s: i64) -> Result<(), LibraryError>;
}

struct Walk<'a> {
    library: &'a Library,
    left: usize,
    truncated: bool,
    /// The real folders on the way down, so a link back up can't loop forever.
    ancestors: HashSet<PathBuf>,
}

impl Walk<'_> {
    fn folder(&mut self, dir: &Path, rel: &str, depth: usize) -> Vec<Node> {
        let Ok(entries) = fs::read_dir(dir) else {
            // An unreadable folder is listed, empty; opening its files would fail anyway.
            return Vec::new();
        };
        let mut nodes = Vec::new();
        for entry in entries.flatten() {
            if self.left == 0 {
                self.truncated = true;
                break;
            }
            // Names that aren't UTF-8 can't be named across the IPC boundary; hidden
            // names (".git", ".obsidian", our own save temporaries) aren't writing.
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if name.starts_with('.') {
                continue;
            }
            if let Some(node) = self.node(&entry, name, rel, depth) {
                self.left -= 1;
                nodes.push(node);
            }
        }
        sort(&mut nodes);
        nodes
    }

    fn node(
        &mut self,
        entry: &fs::DirEntry,
        name: String,
        rel: &str,
        depth: usize,
    ) -> Option<Node> {
        let path = join(rel, &name);
        let file_type = entry.file_type().ok()?;
        let (real, linked) = if file_type.is_symlink() {
            match fs::canonicalize(entry.path()) {
                Ok(real) => (real, true),
                // A dangling link: nothing to open or list.
                Err(_) => return None,
            }
        } else {
            (entry.path(), false)
        };
        let is_dir = if linked {
            real.is_dir()
        } else {
            file_type.is_dir()
        };
        if !is_dir && !is_markdown(&name) {
            return None;
        }
        let kind = if is_dir {
            NodeKind::Folder
        } else {
            NodeKind::File
        };
        let outside = linked && !self.library.contains(&real);
        let looped = is_dir && self.ancestors.contains(&real);
        let mut node = Node {
            name,
            path,
            kind,
            unavailable: outside || looped,
            children: Vec::new(),
        };
        if is_dir && !node.unavailable {
            if depth + 1 >= MAX_DEPTH {
                self.truncated = true;
            } else {
                self.ancestors.insert(real.clone());
                node.children = self.folder(&real, &node.path, depth + 1);
                self.ancestors.remove(&real);
            }
        }
        Some(node)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Scratch;
    use std::os::unix::fs::symlink;
    use std::sync::Mutex;

    fn library(scratch: &Scratch) -> Library {
        fs::create_dir_all(scratch.path().join("lib")).unwrap();
        Library::open(&scratch.path().join("lib")).unwrap()
    }

    fn write(lib: &Library, rel: &str, text: &str) -> PathBuf {
        let path = lib.root().join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, text).unwrap();
        path
    }

    fn names_of(nodes: &[Node]) -> Vec<&str> {
        nodes.iter().map(|n| n.name.as_str()).collect()
    }

    /// Moves trashed entries into a folder of its own, as the system trash would.
    struct FakeTrash {
        dir: PathBuf,
        items: Mutex<Vec<(PathBuf, PathBuf, i64)>>,
        fail: Option<ErrorKind>,
    }

    impl FakeTrash {
        fn new(scratch: &Scratch) -> Self {
            let dir = scratch.path().join("trash");
            fs::create_dir_all(&dir).unwrap();
            FakeTrash {
                dir,
                items: Mutex::new(Vec::new()),
                fail: None,
            }
        }
    }

    impl Trash for FakeTrash {
        fn trash(&self, path: &Path) -> Result<(), LibraryError> {
            if let Some(kind) = self.fail {
                return Err(LibraryError::from_io(&io::Error::from(kind)));
            }
            let mut items = self.items.lock().unwrap();
            let kept = self.dir.join(items.len().to_string());
            fs::rename(path, &kept).map_err(|e| LibraryError::from_io(&e))?;
            items.push((path.to_path_buf(), kept, 0));
            Ok(())
        }

        fn restore(&self, path: &Path, since_s: i64) -> Result<(), LibraryError> {
            let mut items = self.items.lock().unwrap();
            let i = items
                .iter()
                .rposition(|(from, _, at)| from == path && *at >= since_s)
                .ok_or(LibraryError::NotFound)?;
            if fs::symlink_metadata(path).is_ok() {
                return Err(LibraryError::Exists);
            }
            let (from, kept, _) = items.remove(i);
            fs::rename(kept, from).map_err(|e| LibraryError::from_io(&e))
        }
    }

    #[test]
    fn lists_folders_first_in_natural_order_and_only_markdown() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        for rel in [
            "Chapter 10.md",
            "chapter 2.md",
            "Chapter 1.md",
            "notes.markdown",
            "picture.png",
            "todo.txt",
            "zeta/inner.md",
            "Alpha/a.md",
            ".git/config.md",
            ".hidden.md",
            "باب ١٠.md",
            "باب ٢.md",
        ] {
            write(&lib, rel, "x");
        }
        fs::create_dir(lib.root().join("empty")).unwrap();
        let tree = lib.tree().unwrap();
        assert_eq!(
            names_of(&tree.nodes),
            [
                "Alpha",
                "empty",
                "zeta",
                "Chapter 1.md",
                "chapter 2.md",
                "Chapter 10.md",
                "notes.markdown",
                "باب ٢.md",
                "باب ١٠.md",
            ]
        );
        assert!(!tree.truncated);
        let zeta = &tree.nodes[2];
        assert_eq!(zeta.kind, NodeKind::Folder);
        assert_eq!(zeta.children[0].path, "zeta/inner.md");
    }

    #[test]
    fn natural_order_is_total_and_stable() {
        let mut names = vec!["b", "B", "a10", "a9", "a09", "", "a"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, ["", "a", "a09", "a9", "a10", "B", "b"]);
        assert_eq!(natural_cmp("ḥadīth 3", "ḥadīth 20"), Ordering::Less);
    }

    #[test]
    fn sorts_ijmes_and_arabic_names_under_their_letters() {
        let mut names = vec![
            "zakāt.md",
            "ʿIlm.md",
            "Ḥadīth.md",
            "hijra.md",
            "adab.md",
            "ʾUṣūl.md",
            "Ibn Taymiyya.md",
        ];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(
            names,
            [
                "adab.md",
                "Ḥadīth.md",
                "hijra.md",
                "Ibn Taymiyya.md",
                "ʿIlm.md",
                "ʾUṣūl.md",
                "zakāt.md",
            ]
        );
        // Vocalised and bare Arabic sort together; the names themselves are kept.
        assert_eq!(sort_key("سَلَام"), sort_key("سلام"));
        assert_eq!(natural_cmp("سَلَام", "سلام"), "سَلَام".cmp("سلام"));
    }

    #[test]
    fn rejects_paths_that_are_not_plain_names() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        write(&lib, "a.md", "a");
        for bad in [
            "../secret.md",
            "a/../../x",
            "..",
            ".",
            "./a.md",
            "/etc/passwd",
            "a//b",
            "a/",
            "/",
            "a\0b",
        ] {
            assert_eq!(lib.resolve(bad), Err(LibraryError::InvalidPath), "{bad:?}");
            assert_eq!(lib.entry(bad), Err(LibraryError::InvalidPath), "{bad:?}");
        }
        assert_eq!(lib.resolve("a.md").unwrap(), lib.root().join("a.md"));
    }

    #[test]
    fn rejects_symlinks_that_lead_outside_and_lists_them_as_unavailable() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        let secret = scratch.file("secret.md", b"not the writer's library");
        fs::create_dir(scratch.path().join("elsewhere")).unwrap();
        symlink(&secret, lib.root().join("leak.md")).unwrap();
        symlink(scratch.path().join("elsewhere"), lib.root().join("out")).unwrap();
        assert_eq!(lib.resolve("leak.md"), Err(LibraryError::Outside));
        assert_eq!(lib.resolve("out"), Err(LibraryError::Outside));
        assert_eq!(lib.folder("out"), Err(LibraryError::Outside));
        assert_eq!(
            lib.create_folder("out", "x"),
            Err(LibraryError::Outside),
            "nothing is created through a link outside"
        );
        assert!(!scratch.path().join("elsewhere/x").exists());
        let tree = lib.tree().unwrap();
        assert_eq!(names_of(&tree.nodes), ["out", "leak.md"]);
        assert!(
            tree.nodes
                .iter()
                .all(|n| n.unavailable && n.children.is_empty())
        );
    }

    #[test]
    fn follows_symlinks_inside_the_library_and_survives_loops() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        let real = write(&lib, "real/a.md", "a");
        symlink(&real, lib.root().join("alias.md")).unwrap();
        symlink(lib.root().join("real"), lib.root().join("shortcut")).unwrap();
        symlink(lib.root(), lib.root().join("real/up")).unwrap();
        assert_eq!(lib.resolve("alias.md").unwrap(), real);
        assert_eq!(lib.resolve("shortcut/a.md").unwrap(), real);
        let tree = lib.tree().unwrap();
        assert_eq!(names_of(&tree.nodes), ["real", "shortcut", "alias.md"]);
        let up = &tree.nodes[0].children[0];
        assert_eq!((up.name.as_str(), up.unavailable), ("up", true));
        assert_eq!(tree.nodes[1].children[1].path, "shortcut/a.md");
    }

    #[test]
    fn a_link_is_renamed_and_trashed_itself_never_its_target() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        let real = write(&lib, "real.md", "keep me");
        symlink(&real, lib.root().join("link.md")).unwrap();
        let trash = FakeTrash::new(&scratch);
        let renamed = lib.rename("link.md", "renamed link.md").unwrap();
        assert_eq!(renamed.to, lib.root().join("renamed link.md"));
        lib.trash("renamed link.md", &trash).unwrap();
        assert_eq!(fs::read_to_string(&real).unwrap(), "keep me");
        assert!(fs::symlink_metadata(lib.root().join("renamed link.md")).is_err());
    }

    #[test]
    fn knows_relative_paths_and_containment() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        let file = write(&lib, "دفتر/ملاحظات.md", "x");
        let file = fs::canonicalize(file).unwrap();
        assert_eq!(lib.relative(&file).as_deref(), Some("دفتر/ملاحظات.md"));
        assert_eq!(lib.relative(lib.root()).as_deref(), Some(""));
        assert_eq!(lib.relative(scratch.path()), None);
        assert!(!lib.contains(scratch.path()));
    }

    #[test]
    fn validates_names() {
        let problem = |name: &str| match validate_name(name) {
            Err(LibraryError::InvalidName { reason }) => Some(reason),
            _ => None,
        };
        assert_eq!(problem(""), Some(NameProblem::Empty));
        assert_eq!(problem("a/b"), Some(NameProblem::Slash));
        assert_eq!(problem(".hidden"), Some(NameProblem::Dot));
        assert_eq!(problem(".."), Some(NameProblem::Dot));
        assert_eq!(problem("tab\there"), Some(NameProblem::Control));
        assert_eq!(problem(&"x".repeat(256)), Some(NameProblem::TooLong));
        for fine in ["Letter to Ḥasan.md", "رسالة.md", "a b c", "ʿilm — notes"] {
            assert_eq!(problem(fine), None, "{fine}");
        }
    }

    #[test]
    fn creates_folders_without_replacing_anything() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        assert_eq!(lib.create_folder("", "Essays").unwrap(), "Essays");
        assert_eq!(lib.create_folder("Essays", "٢٠٢٦").unwrap(), "Essays/٢٠٢٦");
        assert_eq!(lib.create_folder("", "Essays"), Err(LibraryError::Exists));
        write(&lib, "file.md", "x");
        assert_eq!(lib.create_folder("", "file.md"), Err(LibraryError::Exists));
        assert_eq!(
            lib.create_folder("missing", "x"),
            Err(LibraryError::NotFound)
        );
        assert_eq!(
            lib.create_folder("file.md", "x"),
            Err(LibraryError::InvalidPath)
        );
    }

    #[test]
    fn renames_without_ever_replacing_a_file() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        write(&lib, "draft.md", "draft");
        write(&lib, "final.md", "the final text");
        assert_eq!(
            lib.rename("draft.md", "final.md"),
            Err(LibraryError::Exists)
        );
        assert_eq!(lib.rename("draft.md", "final"), Err(LibraryError::Exists));
        assert_eq!(
            fs::read_to_string(lib.root().join("final.md")).unwrap(),
            "the final text"
        );
        let renamed = lib.rename("draft.md", "Letter to Ḥasan").unwrap();
        assert_eq!(renamed.path, "Letter to Ḥasan.md");
        assert_eq!(fs::read_to_string(&renamed.to).unwrap(), "draft");
        assert!(!renamed.from.exists());
        // A folder keeps the name exactly as typed, and its files move with it.
        write(&lib, "old/inside.md", "inside");
        let folder = lib.rename("old", "new name").unwrap();
        assert_eq!(folder.path, "new name");
        assert!(lib.resolve("new name/inside.md").is_ok());
        // Renaming to the same name changes nothing.
        assert_eq!(lib.rename("final.md", "final.md").unwrap().path, "final.md");
        assert_eq!(lib.rename("missing.md", "x"), Err(LibraryError::NotFound));
        assert!(matches!(
            lib.rename("final.md", "../escape"),
            Err(LibraryError::InvalidName { .. })
        ));
    }

    #[test]
    fn rename_and_new_folder_fail_visibly_in_a_read_only_folder() {
        use std::os::unix::fs::PermissionsExt;
        if platform::is_root() {
            return; // root ignores permission bits
        }
        let scratch = Scratch::new();
        let lib = library(&scratch);
        write(&lib, "locked/a.md", "a");
        let locked = lib.root().join("locked");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        let renamed = lib.rename("locked/a.md", "b.md");
        let created = lib.create_folder("locked", "sub");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(renamed, Err(LibraryError::PermissionDenied));
        assert_eq!(created, Err(LibraryError::PermissionDenied));
        assert_eq!(fs::read_to_string(locked.join("a.md")).unwrap(), "a");
    }

    #[test]
    fn trashes_and_restores_and_never_trashes_the_root() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        let file = write(&lib, "gone.md", "words");
        let trash = FakeTrash::new(&scratch);
        assert_eq!(lib.trash("", &trash), Err(LibraryError::InvalidPath));
        assert_eq!(lib.trash("../lib", &trash), Err(LibraryError::InvalidPath));
        let trashed = lib.trash("gone.md", &trash).unwrap();
        assert!(!file.exists());
        trash.restore(&trashed, 0).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "words");
        // Restoring refuses to replace a file made since.
        lib.trash("gone.md", &trash).unwrap();
        write(&lib, "gone.md", "a new file");
        assert_eq!(trash.restore(&trashed, 0), Err(LibraryError::Exists));
        assert_eq!(fs::read_to_string(&file).unwrap(), "a new file");
    }

    #[test]
    fn a_failed_trash_leaves_the_file_in_place() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        let file = write(&lib, "stays.md", "words");
        let mut trash = FakeTrash::new(&scratch);
        trash.fail = Some(ErrorKind::PermissionDenied);
        assert_eq!(
            lib.trash("stays.md", &trash),
            Err(LibraryError::PermissionDenied)
        );
        assert_eq!(fs::read_to_string(file).unwrap(), "words");
    }

    #[test]
    fn reports_a_library_that_disappeared() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        fs::remove_dir(lib.root()).unwrap();
        assert_eq!(lib.tree(), Err(LibraryError::Unavailable));
        assert_eq!(
            Library::open(&scratch.path().join("lib")),
            Err(LibraryError::Unavailable)
        );
    }

    #[test]
    fn bounds_the_listing() {
        let scratch = Scratch::new();
        let lib = library(&scratch);
        let mut deep = String::new();
        for i in 0..MAX_DEPTH + 2 {
            deep = join(&deep, &format!("d{i}"));
        }
        fs::create_dir_all(lib.root().join(&deep)).unwrap();
        assert!(lib.tree().unwrap().truncated);
    }
}
