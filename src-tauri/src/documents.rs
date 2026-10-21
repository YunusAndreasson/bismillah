//! Opening and saving documents: the file-safety contract (ARCHITECTURE.md §5, ADR-0006).
//!
//! The writer's text is a trust. A save replaces the file only through a durable atomic
//! write, only if nobody else changed the file since we last read or wrote it, and it
//! writes back exactly the text that was edited: same line endings, same BOM, no
//! normalisation of any kind. Every failure is a typed error the UI can explain.

use serde::Serialize;
use std::fs::{self, File, OpenOptions, Permissions};
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

use crate::platform;

/// The line ending a file uses, detected on open and written back on save.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
}

impl LineEnding {
    fn as_str(self) -> &'static str {
        match self {
            LineEnding::Lf => "\n",
            LineEnding::Crlf => "\r\n",
            LineEnding::Cr => "\r",
        }
    }
}

/// A file's bytes split into the editor's text and the details needed to write them back.
#[derive(Debug, PartialEq, Eq)]
pub struct Decoded {
    /// The text with every line break as `\n`, as CodeMirror holds it.
    pub text: String,
    pub line_ending: LineEnding,
    /// The file used more than one line ending; saving writes `line_ending` throughout.
    pub mixed_line_endings: bool,
    pub bom: bool,
    /// False when the file isn't valid UTF-8. `text` is then a lossy rendering for reading
    /// only, and the document must never be saved (ARCHITECTURE.md §5.3).
    pub utf8: bool,
}

const BOM: &[u8] = b"\xEF\xBB\xBF";

/// Splits a file into text and line-ending details. Line breaks are recognised exactly
/// as CodeMirror recognises them (`\r\n`, `\r`, `\n`), so `encode(decode(b))` gives back
/// `b` for every file with a single line-ending style.
pub fn decode(bytes: &[u8]) -> Decoded {
    let (bom, body) = match bytes.strip_prefix(BOM) {
        Some(rest) => (true, rest),
        None => (false, bytes),
    };
    let (raw, utf8) = match std::str::from_utf8(body) {
        Ok(s) => (std::borrow::Cow::Borrowed(s), true),
        Err(_) => (String::from_utf8_lossy(body), false),
    };
    let (mut lf, mut crlf, mut cr) = (0usize, 0usize, 0usize);
    let mut text = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\r' if chars.peek() == Some(&'\n') => {
                chars.next();
                crlf += 1;
                text.push('\n');
            }
            '\r' => {
                cr += 1;
                text.push('\n');
            }
            '\n' => {
                lf += 1;
                text.push('\n');
            }
            c => text.push(c),
        }
    }
    // The most frequent style wins; ties and files without line breaks use LF.
    let line_ending = if crlf > lf && crlf >= cr {
        LineEnding::Crlf
    } else if cr > lf && cr > crlf {
        LineEnding::Cr
    } else {
        LineEnding::Lf
    };
    let styles = [lf, crlf, cr].iter().filter(|&&n| n > 0).count();
    Decoded {
        text,
        line_ending,
        mixed_line_endings: styles > 1,
        bom,
        utf8,
    }
}

/// The bytes to write for the editor's text: `\n` becomes the file's line ending, and
/// the BOM is restored if the file had one. Nothing else changes.
pub fn encode(text: &str, line_ending: LineEnding, bom: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + if bom { 3 } else { 0 });
    if bom {
        out.extend_from_slice(BOM);
    }
    if line_ending == LineEnding::Lf {
        out.extend_from_slice(text.as_bytes());
    } else {
        for (i, line) in text.split('\n').enumerate() {
            if i > 0 {
                out.extend_from_slice(line_ending.as_str().as_bytes());
            }
            out.extend_from_slice(line.as_bytes());
        }
    }
    out
}

/// A save failure, explained to the writer in plain words by the UI (DESIGN.md §14).
/// Carries no document text and no paths, so it can be logged.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SaveError {
    #[error("the disk is full")]
    DiskFull,
    #[error("the volume is read-only")]
    ReadOnlyVolume,
    #[error("permission denied")]
    PermissionDenied,
    #[error("the file was moved or deleted")]
    Removed,
    #[error("the folder is unavailable")]
    Unavailable,
    #[error("the file changed on disk")]
    Conflict,
    #[error("the file isn't UTF-8 text")]
    NotUtf8,
    #[error("the document isn't saved to a file")]
    NotAFile,
    #[error("the document is no longer open")]
    Closed,
    #[error("a file with that name already exists")]
    Exists,
    #[error("input/output error ({detail})")]
    Other { detail: String },
}

impl SaveError {
    /// Classifies an I/O error. Only the error kind is kept, never a path.
    pub fn from_io(e: &io::Error) -> Self {
        match e.kind() {
            ErrorKind::StorageFull | ErrorKind::QuotaExceeded | ErrorKind::FileTooLarge => {
                SaveError::DiskFull
            }
            ErrorKind::ReadOnlyFilesystem => SaveError::ReadOnlyVolume,
            ErrorKind::PermissionDenied => SaveError::PermissionDenied,
            ErrorKind::AlreadyExists => SaveError::Exists,
            // The folder itself is gone: removed, or its volume unmounted.
            ErrorKind::NotFound | ErrorKind::NotADirectory | ErrorKind::StaleNetworkFileHandle => {
                SaveError::Unavailable
            }
            kind => SaveError::Other {
                detail: format!("{kind:?}"),
            },
        }
    }
}

/// Why a file couldn't be opened.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OpenError {
    #[error("the file doesn't exist")]
    NotFound,
    #[error("permission denied")]
    PermissionDenied,
    #[error("it isn't a file")]
    NotAFile,
    #[error("it is outside the library")]
    Outside,
    #[error("input/output error ({detail})")]
    Other { detail: String },
}

impl OpenError {
    fn from_io(e: &io::Error) -> Self {
        match e.kind() {
            ErrorKind::NotFound => OpenError::NotFound,
            ErrorKind::PermissionDenied => OpenError::PermissionDenied,
            ErrorKind::IsADirectory => OpenError::NotAFile,
            kind => OpenError::Other {
                detail: format!("{kind:?}"),
            },
        }
    }
}

/// What a file looked like when we last read or wrote it (ARCHITECTURE.md §5.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DiskState {
    pub mtime: Option<SystemTime>,
    pub size: u64,
    pub hash: u64,
}

impl DiskState {
    fn of(meta: &fs::Metadata, bytes: &[u8]) -> Self {
        DiskState {
            mtime: meta.modified().ok(),
            size: meta.len(),
            hash: content_hash(bytes),
        }
    }
}

/// A stable 64-bit FNV-1a hash for local change detection and file identifiers.
pub fn content_hash(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, &b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// An open document backed by a file.
#[derive(Debug)]
pub struct Document {
    /// Canonical path: symlinks resolved, so a save replaces the real file and leaves
    /// the link in place.
    pub path: PathBuf,
    pub line_ending: LineEnding,
    pub bom: bool,
    pub utf8: bool,
    pub disk: DiskState,
    /// The newest revision known to be durably on disk.
    pub saved_revision: u64,
}

impl Document {
    pub fn name(&self) -> String {
        display_name(&self.path)
    }
}

pub fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "untitled".into())
}

/// Opens a file: reads it, records its state on disk and removes temporary files a
/// crashed save of ours may have left next to it.
pub fn open(path: &Path) -> Result<(Document, Decoded), OpenError> {
    let path = fs::canonicalize(path).map_err(|e| OpenError::from_io(&e))?;
    let meta = fs::metadata(&path).map_err(|e| OpenError::from_io(&e))?;
    if !meta.is_file() {
        return Err(OpenError::NotAFile);
    }
    let bytes = fs::read(&path).map_err(|e| OpenError::from_io(&e))?;
    remove_stale_temps(&path);
    let decoded = decode(&bytes);
    let doc = Document {
        disk: DiskState::of(&meta, &bytes),
        line_ending: decoded.line_ending,
        bom: decoded.bom,
        utf8: decoded.utf8,
        saved_revision: 0,
        path,
    };
    Ok((doc, decoded))
}

/// Creates a new, empty document. Never replaces an existing file.
pub fn create(path: &Path) -> Result<(Document, Decoded), SaveError> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| SaveError::from_io(&e))?;
    file.sync_all().map_err(|e| SaveError::from_io(&e))?;
    drop(file);
    if let Some(dir) = path.parent() {
        platform::sync_dir(dir).map_err(|e| SaveError::from_io(&e))?;
    }
    open(path).map_err(|_| SaveError::Unavailable)
}

/// The steps of a durable atomic write, named so tests can inject a failure at each one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Create,
    Write,
    Permissions,
    Sync,
    Rename,
    SyncDir,
}

/// Called before each step; returning an error makes that step fail. Production code
/// passes [`NO_FAULTS`].
pub type Faults<'a> = &'a dyn Fn(Step) -> io::Result<()>;
pub const NO_FAULTS: Faults<'static> = &|_| Ok(());

/// Saves `text` as revision `revision` (ARCHITECTURE.md §5).
///
/// Unless `force` is set ("Keep mine" after a conflict), the file must still be as we
/// last saw it. A revision that is not newer than the last saved one is not written
/// again: a newer save already reached the disk.
pub fn save(
    doc: &mut Document,
    text: &str,
    revision: u64,
    force: bool,
    faults: Faults<'_>,
) -> Result<u64, SaveError> {
    if revision <= doc.saved_revision {
        return Ok(doc.saved_revision);
    }
    if !doc.utf8 {
        return Err(SaveError::NotUtf8);
    }
    let permissions = match fs::metadata(&doc.path) {
        Ok(meta) => {
            if !force {
                check_unchanged(doc, &meta)?;
            }
            // Refuse early, before any temporary file exists, if the file itself is
            // read-only: replacing it by rename would quietly defeat its permissions.
            // Opening for writing without truncating changes nothing.
            OpenOptions::new()
                .write(true)
                .open(&doc.path)
                .map_err(|e| SaveError::from_io(&e))?;
            Some(meta.permissions())
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {
            let dir_exists = doc.path.parent().is_some_and(Path::is_dir);
            match (force, dir_exists) {
                (_, false) => return Err(SaveError::Unavailable),
                (false, true) => return Err(SaveError::Removed),
                (true, true) => None,
            }
        }
        Err(e) => return Err(SaveError::from_io(&e)),
    };
    let bytes = encode(text, doc.line_ending, doc.bom);
    write_atomic(&doc.path, &bytes, permissions, faults).map_err(|e| SaveError::from_io(&e))?;
    let meta = fs::metadata(&doc.path).map_err(|e| SaveError::from_io(&e))?;
    doc.disk = DiskState::of(&meta, &bytes);
    doc.saved_revision = revision;
    Ok(revision)
}

/// Whether the file on disk still matches what we last read or wrote. A changed mtime or
/// size alone is not a conflict: the bytes are compared too, so `touch` is harmless.
fn check_unchanged(doc: &mut Document, meta: &fs::Metadata) -> Result<(), SaveError> {
    if meta.modified().ok() == doc.disk.mtime && meta.len() == doc.disk.size {
        return Ok(());
    }
    let bytes = fs::read(&doc.path).map_err(|e| SaveError::from_io(&e))?;
    if content_hash(&bytes) != doc.disk.hash {
        return Err(SaveError::Conflict);
    }
    doc.disk = DiskState::of(meta, &bytes);
    Ok(())
}

/// What a check of the file on disk found (window focus, before reloading).
#[derive(Debug, PartialEq, Eq)]
pub enum DiskCheck {
    Unchanged,
    Changed,
    Removed,
}

pub fn check_disk(doc: &mut Document) -> DiskCheck {
    match fs::metadata(&doc.path) {
        Ok(meta) => match check_unchanged(doc, &meta) {
            Ok(()) => DiskCheck::Unchanged,
            Err(_) => DiskCheck::Changed,
        },
        Err(_) => DiskCheck::Removed,
    }
}

const TEMP_MARK: &str = ".bismillah-save-";

fn temp_prefix(target: &Path) -> String {
    // Do not append a suffix to the original basename: a legal 255-byte filename
    // would make the temporary's component exceed the filesystem's name limit.
    format!(
        "{TEMP_MARK}{:016x}-",
        content_hash(&platform::path_bytes(target))
    )
}

/// Durable atomic replacement (ARCHITECTURE.md §5.2): a temporary file in the same
/// directory, the original's permissions, fsync, rename over the target, fsync the
/// directory. If any step before the rename fails, the original is untouched and the
/// temporary file is removed.
pub fn write_atomic(
    target: &Path,
    bytes: &[u8],
    permissions: Option<Permissions>,
    faults: Faults<'_>,
) -> io::Result<()> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let dir = target
        .parent()
        .ok_or_else(|| io::Error::from(ErrorKind::InvalidInput))?;
    let temp = dir.join(format!(
        "{}{}-{}",
        temp_prefix(target),
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    faults(Step::Create)?;
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let written = (|| {
        let mut file = file;
        faults(Step::Write)?;
        file.write_all(bytes)?;
        if let Some(permissions) = permissions {
            faults(Step::Permissions)?;
            file.set_permissions(permissions)?;
        }
        faults(Step::Sync)?;
        file.sync_all()?;
        drop(file);
        faults(Step::Rename)?;
        fs::rename(&temp, target)
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    faults(Step::SyncDir)?;
    platform::sync_dir(dir)
}

/// Removes temporary files that a save of ours was killed in the middle of writing.
/// Matches only our own naming pattern for this file.
fn remove_stale_temps(target: &Path) {
    let (Some(dir), prefix) = (target.parent(), temp_prefix(target)) else {
        return;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    // Also clean up interrupted saves made by versions that used the basename.
    let legacy = format!(".{}{TEMP_MARK}", display_name(target));
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let ours = [&prefix, &legacy].iter().any(|prefix| {
            name.strip_prefix(prefix.as_str())
                .and_then(|rest| rest.split_once('-'))
                .is_some_and(|(pid, counter)| {
                    !pid.is_empty()
                        && !counter.is_empty()
                        && pid.chars().all(|c| c.is_ascii_digit())
                        && counter.chars().all(|c| c.is_ascii_digit())
                })
        });
        if ours && entry.file_type().is_ok_and(|t| t.is_file()) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Reads a file only to compare it (tests and the reload path).
pub fn read(path: &Path) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    io::Read::read_to_end(&mut File::open(path)?, &mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Scratch;

    const VOCALISED: &str = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ — mixed with *English*, ḥadīth and ʿilm.\n";

    fn open_text(scratch: &Scratch, name: &str, bytes: &[u8]) -> (Document, Decoded) {
        let path = scratch.file(name, bytes);
        open(&path).expect("fixture opens")
    }

    fn fail_at(step: Step, kind: ErrorKind) -> impl Fn(Step) -> io::Result<()> {
        move |s| {
            if s == step {
                Err(io::Error::from(kind))
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn round_trips_every_single_style_file_byte_for_byte() {
        let cases: &[&[u8]] = &[
            b"",
            b"no newline at the end",
            b"line one\nline two\n",
            b"line one\r\nline two\r\n\r\n",
            b"old mac\rstyle\r",
            b"\xEF\xBB\xBFwith a BOM\r\nand CRLF\r\n",
            VOCALISED.as_bytes(),
            "قُلْ هُوَ ٱللَّهُ أَحَدٌ\r\nٱللَّهُ ٱلصَّمَدُ\r\n".as_bytes(),
            "e\u{301} vs \u{e9}, \u{fdfd}, emoji 👩🏽‍💻, ZWJ\u{200d}, NBSP\u{a0}\n".as_bytes(),
        ];
        for &bytes in cases {
            let d = decode(bytes);
            assert!(!d.mixed_line_endings);
            assert_eq!(encode(&d.text, d.line_ending, d.bom), bytes, "{bytes:?}");
        }
    }

    #[test]
    fn decodes_line_breaks_as_codemirror_does() {
        let d = decode(b"a\r\nb\rc\nd");
        assert_eq!(d.text, "a\nb\nc\nd");
        assert!(d.mixed_line_endings);
        assert_eq!(decode(b"a\r\nb\r\nc\n").line_ending, LineEnding::Crlf);
        assert_eq!(decode(b"a\nb\nc\r\n").line_ending, LineEnding::Lf);
    }

    #[test]
    fn opens_files_that_are_not_utf8_for_reading_only() {
        let scratch = Scratch::new();
        let (mut doc, decoded) = open_text(&scratch, "latin1.md", b"caf\xe9\n");
        assert!(!decoded.utf8);
        assert_eq!(decoded.text, "caf\u{fffd}\n");
        assert_eq!(
            save(&mut doc, "cafe\n", 1, false, NO_FAULTS),
            Err(SaveError::NotUtf8)
        );
        assert_eq!(read(&doc.path).unwrap(), b"caf\xe9\n");
    }

    #[test]
    fn saves_exactly_the_edited_text_with_the_files_line_endings_and_bom() {
        let scratch = Scratch::new();
        let original = "\u{feff}# عنوان\r\nبِسْمِ ٱللَّهِ\r\n";
        let (mut doc, decoded) = open_text(&scratch, "crlf.md", original.as_bytes());
        assert_eq!(decoded.text, "# عنوان\nبِسْمِ ٱللَّهِ\n");
        let edited = format!("{}ḥ\n", decoded.text);
        assert_eq!(save(&mut doc, &edited, 1, false, NO_FAULTS), Ok(1));
        assert_eq!(
            read(&doc.path).unwrap(),
            "\u{feff}# عنوان\r\nبِسْمِ ٱللَّهِ\r\nḥ\r\n".as_bytes()
        );
        // Saving the original text again restores the original bytes.
        save(&mut doc, &decoded.text, 2, false, NO_FAULTS).unwrap();
        assert_eq!(read(&doc.path).unwrap(), original.as_bytes());
    }

    #[test]
    fn keeps_the_files_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let scratch = Scratch::new();
        let (mut doc, _) = open_text(&scratch, "private.md", b"secret\n");
        fs::set_permissions(&doc.path, Permissions::from_mode(0o640)).unwrap();
        doc.disk = DiskState::of(&fs::metadata(&doc.path).unwrap(), b"secret\n");
        save(&mut doc, "still secret\n", 1, false, NO_FAULTS).unwrap();
        let mode = fs::metadata(&doc.path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
    }

    #[test]
    fn saves_files_whose_names_fill_the_filesystem_component_limit() {
        for name in [
            format!("{}.md", "W".repeat(252)),
            format!("{}.md", "س".repeat(126)),
        ] {
            assert_eq!(name.len(), 255);
            let scratch = Scratch::new();
            let (mut doc, _) = open_text(&scratch, &name, b"original\n");
            // A failure after creating and writing the temporary leaves the original
            // intact, with no temporary left behind. Retrying preserves exact bytes.
            let failed = save(
                &mut doc,
                VOCALISED,
                1,
                false,
                &fail_at(Step::Rename, ErrorKind::PermissionDenied),
            );
            assert_eq!(failed, Err(SaveError::PermissionDenied));
            assert_eq!(read(&doc.path).unwrap(), b"original\n");
            assert_eq!(scratch.entries(), vec![name.clone()]);
            assert_eq!(doc.saved_revision, 0);
            assert_eq!(save(&mut doc, VOCALISED, 2, false, NO_FAULTS), Ok(2));
            assert_eq!(read(&doc.path).unwrap(), VOCALISED.as_bytes());
            assert_eq!(scratch.entries(), vec![name]);
        }
    }

    #[test]
    fn a_failure_at_any_step_leaves_the_original_untouched_and_no_temporary_file() {
        let cases = [
            (
                Step::Create,
                ErrorKind::PermissionDenied,
                SaveError::PermissionDenied,
            ),
            (Step::Write, ErrorKind::StorageFull, SaveError::DiskFull),
            (
                Step::Permissions,
                ErrorKind::PermissionDenied,
                SaveError::PermissionDenied,
            ),
            (
                Step::Sync,
                ErrorKind::ReadOnlyFilesystem,
                SaveError::ReadOnlyVolume,
            ),
            (
                Step::Rename,
                ErrorKind::Other,
                SaveError::Other {
                    detail: "Other".into(),
                },
            ),
        ];
        for (step, kind, expected) in cases {
            let scratch = Scratch::new();
            let (mut doc, _) = open_text(&scratch, "safe.md", b"original\n");
            let result = save(&mut doc, "new text\n", 1, false, &fail_at(step, kind));
            assert_eq!(result, Err(expected), "{step:?}");
            assert_eq!(read(&doc.path).unwrap(), b"original\n", "{step:?}");
            assert_eq!(scratch.entries(), vec!["safe.md"], "{step:?}");
            assert_eq!(doc.saved_revision, 0);
            // The next attempt, without the fault, succeeds.
            assert_eq!(save(&mut doc, "new text\n", 2, false, NO_FAULTS), Ok(2));
        }
    }

    #[test]
    fn a_failed_directory_sync_is_reported() {
        let scratch = Scratch::new();
        let (mut doc, _) = open_text(&scratch, "d.md", b"a\n");
        let result = save(
            &mut doc,
            "b\n",
            1,
            false,
            &fail_at(Step::SyncDir, ErrorKind::Other),
        );
        assert!(matches!(result, Err(SaveError::Other { .. })));
        assert_eq!(
            doc.saved_revision, 0,
            "never report Saved without a durable write"
        );
    }

    #[test]
    fn refuses_to_overwrite_external_changes() {
        let scratch = Scratch::new();
        let (mut doc, _) = open_text(&scratch, "shared.md", b"ours\n");
        fs::write(&doc.path, b"theirs, longer\n").unwrap();
        assert_eq!(
            save(&mut doc, "mine\n", 1, false, NO_FAULTS),
            Err(SaveError::Conflict)
        );
        assert_eq!(read(&doc.path).unwrap(), b"theirs, longer\n");
        assert_eq!(check_disk(&mut doc), DiskCheck::Changed);
        // "Keep mine" saves over it.
        assert_eq!(save(&mut doc, "mine\n", 1, true, NO_FAULTS), Ok(1));
        assert_eq!(read(&doc.path).unwrap(), b"mine\n");
        assert_eq!(check_disk(&mut doc), DiskCheck::Unchanged);
    }

    #[test]
    fn a_touch_without_new_content_is_not_a_conflict() {
        let scratch = Scratch::new();
        let (mut doc, _) = open_text(&scratch, "touched.md", b"same\n");
        let later = SystemTime::now() + std::time::Duration::from_secs(5);
        File::options()
            .write(true)
            .open(&doc.path)
            .unwrap()
            .set_modified(later)
            .unwrap();
        assert_eq!(save(&mut doc, "edited\n", 1, false, NO_FAULTS), Ok(1));
    }

    #[test]
    fn reports_a_removed_file_and_recreates_it_only_when_asked() {
        let scratch = Scratch::new();
        let (mut doc, _) = open_text(&scratch, "gone.md", b"text\n");
        fs::remove_file(&doc.path).unwrap();
        assert_eq!(check_disk(&mut doc), DiskCheck::Removed);
        assert_eq!(
            save(&mut doc, "text\n", 1, false, NO_FAULTS),
            Err(SaveError::Removed)
        );
        assert_eq!(save(&mut doc, "text\n", 1, true, NO_FAULTS), Ok(1));
        assert_eq!(read(&doc.path).unwrap(), b"text\n");
    }

    #[test]
    fn respects_read_only_files_and_folders() {
        use std::os::unix::fs::PermissionsExt;
        if platform::is_root() {
            return; // root ignores permission bits
        }
        let scratch = Scratch::new();
        let (mut doc, _) = open_text(&scratch, "locked.md", b"locked\n");
        fs::set_permissions(&doc.path, Permissions::from_mode(0o444)).unwrap();
        assert_eq!(
            save(&mut doc, "changed\n", 1, false, NO_FAULTS),
            Err(SaveError::PermissionDenied)
        );
        assert_eq!(read(&doc.path).unwrap(), b"locked\n");

        fs::set_permissions(&doc.path, Permissions::from_mode(0o644)).unwrap();
        fs::set_permissions(scratch.path(), Permissions::from_mode(0o555)).unwrap();
        let result = save(&mut doc, "changed\n", 2, false, NO_FAULTS);
        fs::set_permissions(scratch.path(), Permissions::from_mode(0o755)).unwrap();
        assert_eq!(result, Err(SaveError::PermissionDenied));
        assert_eq!(read(&doc.path).unwrap(), b"locked\n");
        assert_eq!(scratch.entries(), vec!["locked.md"]);
    }

    #[test]
    fn saves_through_a_symlink_into_the_real_file() {
        let scratch = Scratch::new();
        let real = scratch.file("real.md", b"real\n");
        let link = scratch.path().join("link.md");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let (mut doc, _) = open(&link).unwrap();
        save(&mut doc, "via link\n", 1, false, NO_FAULTS).unwrap();
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(read(&real).unwrap(), b"via link\n");
    }

    #[test]
    fn never_writes_an_older_revision_over_a_newer_one() {
        let scratch = Scratch::new();
        let (mut doc, _) = open_text(&scratch, "order.md", b"0\n");
        assert_eq!(save(&mut doc, "two\n", 2, false, NO_FAULTS), Ok(2));
        assert_eq!(save(&mut doc, "one\n", 1, false, NO_FAULTS), Ok(2));
        assert_eq!(read(&doc.path).unwrap(), b"two\n");
    }

    #[test]
    fn removes_temporary_files_left_by_a_killed_save_of_this_file_only() {
        let scratch = Scratch::new();
        scratch.file("note.md", b"note\n");
        scratch.file(".note.md.bismillah-save-4242-0", b"half writ");
        scratch.file(".other.md.bismillah-save-4242-0", b"another file's");
        scratch.file(".note.md.bismillah-save-notours", b"not our pattern");
        open(&scratch.path().join("note.md")).unwrap();
        assert_eq!(
            scratch.entries(),
            vec![
                ".note.md.bismillah-save-notours",
                ".other.md.bismillah-save-4242-0",
                "note.md"
            ]
        );
    }

    #[test]
    fn cleans_short_temporary_names_for_long_files_without_touching_other_files() {
        let scratch = Scratch::new();
        let path = scratch.file(&format!("{}.md", "W".repeat(252)), b"original\n");
        let other = scratch.file("other.md", b"other\n");
        let stale = format!("{}4242-0", temp_prefix(&path));
        let untouched = format!("{}4242-0", temp_prefix(&other));
        let malformed = format!("{}-1", temp_prefix(&path));
        scratch.file(&stale, b"interrupted save");
        scratch.file(&untouched, b"another file's save");
        scratch.file(&malformed, b"not our pattern");
        open(&path).unwrap();
        assert!(!scratch.path().join(stale).exists());
        assert!(scratch.path().join(untouched).exists());
        assert!(scratch.path().join(malformed).exists());
        assert_eq!(scratch.entries().len(), 4);
        assert_eq!(read(&path).unwrap(), b"original\n");
        assert_eq!(read(&other).unwrap(), b"other\n");
    }

    #[test]
    fn creates_new_files_without_replacing_existing_ones() {
        let scratch = Scratch::new();
        let path = scratch.path().join("new.md");
        let (doc, decoded) = create(&path).unwrap();
        assert_eq!(decoded.text, "");
        assert_eq!(doc.line_ending, LineEnding::Lf);
        assert_eq!(create(&path).map(|_| ()), Err(SaveError::Exists));
    }

    #[test]
    fn explains_open_failures() {
        let scratch = Scratch::new();
        assert_eq!(
            open(&scratch.path().join("missing.md")).map(|_| ()),
            Err(OpenError::NotFound)
        );
        assert_eq!(open(scratch.path()).map(|_| ()), Err(OpenError::NotAFile));
    }
}
