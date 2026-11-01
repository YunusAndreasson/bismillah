//! Print to Phone (ADR-0021). The frontend sends the text and which QR size fits; Rust
//! makes it the bytes a save would write and hands out one frame at a time. The text
//! lives here only until the dialog closes, and never reaches a log. *Print whole library*
//! prints the files on the disk instead, as they are, each read when its turn comes.

use std::sync::Mutex;

use bismillah_print::{
    DENSITIES, FRAMES_PER_SECOND, Frame, PhoneKey, Playlist, Position, Printer, QUIET_MODULES,
    Skipped, envelope, seal,
};
use serde::Serialize;
use tauri::State;

use super::{AppState, Source, lock};
use crate::documents::{self, LineEnding};
use crate::library::{Library, Node, NodeKind};

/// What's being shown: one text, or every text in the library.
enum Job {
    One(Printer),
    Run(Playlist),
}

/// The one print under way. A static: nothing else shares it, and only debug builds have it.
static JOB: Mutex<Option<Job>> = Mutex::new(None);

#[derive(Serialize)]
pub struct PrintSizes {
    /// Modules a side of each QR size, densest first, with the quiet zone.
    sides: Vec<u32>,
    frames_per_second: u32,
}

#[derive(Serialize)]
pub struct PrintJob {
    /// One fragment: a single still frame holds it all.
    still: bool,
    seconds: u32,
    /// How many texts a library run holds; 0 for one text.
    texts: usize,
    /// What a library run leaves out. It's a backup, so the writer is told by name.
    left_out: Vec<LeftOut>,
    /// The library is larger than a listing reaches, so the run may not hold it all.
    truncated: bool,
    /// The check words of the key this is sealed to, or nothing if it isn't sealed.
    sealed_words: Option<String>,
}

#[derive(Serialize)]
pub struct LeftOut {
    name: String,
    why: Why,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Why {
    Empty,
    Unreadable,
    TooLong,
}

impl From<Skipped> for Why {
    fn from(skipped: Skipped) -> Self {
        match skipped {
            Skipped::Empty => Self::Empty,
            Skipped::Unreadable => Self::Unreadable,
            Skipped::TooLong => Self::TooLong,
        }
    }
}

/// Which text of a library run is on the screen.
#[derive(Serialize)]
pub struct PrintPlace {
    /// From 0.
    index: usize,
    count: usize,
    name: String,
    round: u32,
}

impl From<Position> for PrintPlace {
    fn from(position: Position) -> Self {
        Self {
            index: position.index,
            count: position.count,
            name: position.name,
            round: position.round,
        }
    }
}

#[derive(Serialize)]
pub struct PrintFrame {
    /// Modules on a side, with the quiet zone drawn by the frontend.
    size: u32,
    quiet: u32,
    /// `size * size` characters, row by row: `1` is dark.
    modules: String,
    place: Option<PrintPlace>,
}

/// Says only what the writer can act on: nothing about the text.
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PrintError {
    #[error("no such document")]
    Closed,
    #[error("the code could not be made")]
    Failed,
    #[error("nothing in the library can be printed")]
    Empty,
}

/// The bytes a save would write for the whole document, so line endings and a BOM arrive
/// as they are on disk. A selection takes the line ending, and no BOM, which only starts
/// a file.
fn print_bytes(source: &Source, text: &str, selection: bool) -> (String, Vec<u8>) {
    let (name, line_ending, bom) = match source {
        Source::File(doc) => (doc.name(), doc.line_ending, doc.bom),
        Source::Sample(name) => ((*name).to_owned(), LineEnding::Lf, false),
    };
    (
        name,
        documents::encode(text, line_ending, bom && !selection),
    )
}

/// The key the writer typed in, which can only seal. It isn't secret, and it stays in the
/// config folder like a setting: on the stick that's inside the encrypted home.
fn phone_key_path(state: &AppState) -> std::path::PathBuf {
    state.config_dir.join("phone-key.txt")
}

/// A file that no longer holds a key means not paired, which the dialog says in plain words.
fn paired(state: &AppState) -> Option<PhoneKey> {
    let text = std::fs::read_to_string(phone_key_path(state)).ok()?;
    PhoneKey::parse(&text).ok()
}

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PairError {
    #[error("that isn't a phone's key")]
    NotAKey,
    #[error("the key could not be saved")]
    NotSaved,
}

/// Checks the key as typed and keeps it, replacing any earlier one. Returns its check words.
#[tauri::command]
pub fn print_pair(state: State<'_, AppState>, key: String) -> Result<String, PairError> {
    let key = PhoneKey::parse(&key).map_err(|_| PairError::NotAKey)?;
    std::fs::create_dir_all(&state.config_dir).map_err(|_| PairError::NotSaved)?;
    documents::write_atomic(
        &phone_key_path(&state),
        key.text().as_bytes(),
        None,
        documents::NO_FAULTS,
    )
    .map_err(|_| PairError::NotSaved)?;
    Ok(key.check_words())
}

#[tauri::command]
pub fn print_sizes() -> PrintSizes {
    PrintSizes {
        sides: DENSITIES
            .iter()
            .map(|d| d.modules + 2 * QUIET_MODULES)
            .collect(),
        frames_per_second: FRAMES_PER_SECOND,
    }
}

#[tauri::command]
pub async fn print_start(
    state: State<'_, AppState>,
    id: u64,
    text: String,
    selection: bool,
    density: usize,
) -> Result<PrintJob, PrintError> {
    let open = state.current(id).ok_or(PrintError::Closed)?;
    let density = *DENSITIES.get(density).ok_or(PrintError::Failed)?;
    let sealed_to = paired(&state);
    // Compressing a long document takes a moment, so it runs off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        let (name, bytes) = print_bytes(&lock(&open).source, &text, selection);
        let message = envelope(&name, selection, &bytes).map_err(|_| PrintError::Failed)?;
        let message = match &sealed_to {
            Some(key) => seal(key, &message).map_err(|_| PrintError::Failed)?,
            None => message,
        };
        let printer = Printer::new(&message, density).map_err(|_| PrintError::Failed)?;
        let job = PrintJob {
            still: printer.fragments() == 1,
            seconds: printer.seconds(),
            texts: 0,
            left_out: Vec::new(),
            truncated: false,
            sealed_words: sealed_to.as_ref().map(PhoneKey::check_words),
        };
        *lock(&JOB) = Some(Job::One(printer));
        Ok(job)
    })
    .await
    .map_err(|_| PrintError::Failed)?
}

/// Every Markdown file the library lists, by its path, each checked against the root when
/// it's read (`Library::resolve`), so a link leading outside is left out by name.
fn library_files(nodes: &[Node], files: &mut Vec<String>) {
    for node in nodes {
        match node.kind {
            NodeKind::File => files.push(node.path.clone()),
            NodeKind::Folder => library_files(&node.children, files),
        }
    }
}

fn library_run(
    library: Library,
    density: usize,
    from: usize,
    sealed_to: Option<PhoneKey>,
) -> Result<(Playlist, PrintJob), PrintError> {
    let density = *DENSITIES.get(density).ok_or(PrintError::Failed)?;
    let tree = library.tree().map_err(|_| PrintError::Failed)?;
    let mut files = Vec::new();
    library_files(&tree.nodes, &mut files);
    let read = move |name: &str| std::fs::read(library.resolve(name).ok()?).ok();
    let sealed_words = sealed_to.as_ref().map(PhoneKey::check_words);
    let (playlist, skipped) = Playlist::new(files, density, sealed_to, Box::new(read));
    let mut playlist = playlist.ok_or(PrintError::Empty)?;
    playlist.go_to(from);
    let job = PrintJob {
        still: false,
        seconds: playlist.seconds(),
        texts: playlist.count(),
        left_out: skipped
            .into_iter()
            .map(|(name, skipped)| LeftOut {
                name,
                why: skipped.into(),
            })
            .collect(),
        truncated: tree.truncated,
        sealed_words,
    };
    Ok((playlist, job))
}

/// Starts a run of the whole library at text `from`, which a new QR size carries over.
#[tauri::command]
pub async fn print_library_start(
    state: State<'_, AppState>,
    density: usize,
    from: usize,
) -> Result<PrintJob, PrintError> {
    let library = state.library().map_err(|_| PrintError::Failed)?;
    let sealed_to = paired(&state);
    // Reading and compressing every text takes a while, so it runs off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        let (playlist, job) = library_run(library, density, from, sealed_to)?;
        *lock(&JOB) = Some(Job::Run(playlist));
        Ok(job)
    })
    .await
    .map_err(|_| PrintError::Failed)?
}

/// Goes straight to a text the phone says it lacks.
#[tauri::command]
pub fn print_go_to(index: usize) {
    if let Some(Job::Run(playlist)) = lock(&JOB).as_mut() {
        playlist.go_to(index);
    }
}

fn print_frame_of(frame: Frame, place: Option<PrintPlace>) -> PrintFrame {
    PrintFrame {
        size: frame.size,
        quiet: QUIET_MODULES,
        modules: frame
            .dark
            .iter()
            .map(|dark| if *dark { '1' } else { '0' })
            .collect(),
        place,
    }
}

/// The next frame; `None` once the print has stopped. A run's next text is read and
/// compressed on the way, so this too runs off the async runtime.
#[tauri::command]
pub async fn print_frame() -> Result<Option<PrintFrame>, PrintError> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut job = lock(&JOB);
        match job.as_mut() {
            None => Ok(None),
            Some(Job::One(printer)) => {
                let frame = printer.next_frame().map_err(|_| PrintError::Failed)?;
                Ok(Some(print_frame_of(frame, None)))
            }
            Some(Job::Run(playlist)) => {
                let (frame, position) = playlist.next_frame().map_err(|_| PrintError::Failed)?;
                Ok(Some(print_frame_of(frame, Some(position.into()))))
            }
        }
    })
    .await
    .map_err(|_| PrintError::Failed)?
}

#[tauri::command]
pub fn print_stop() {
    *lock(&JOB) = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sample_prints_its_text_as_it_stands() {
        let source = Source::Sample("guide.md");
        let (name, bytes) = print_bytes(&source, "a\nb", false);
        assert_eq!(name, "guide.md");
        assert_eq!(bytes, b"a\nb");
    }

    #[test]
    fn a_file_prints_the_bytes_a_save_writes_and_a_selection_drops_only_the_bom() {
        let dir = std::env::temp_dir().join(format!("bismillah-print-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("crlf.md");
        std::fs::write(&path, b"\xef\xbb\xbfone\r\ntwo\r\n").unwrap();
        let (doc, decoded) = documents::open(&path).unwrap();
        let source = Source::File(doc);
        let (name, whole) = print_bytes(&source, &decoded.text, false);
        assert_eq!(name, "crlf.md");
        assert_eq!(whole, std::fs::read(&path).unwrap());
        let (_, part) = print_bytes(&source, "one\ntwo", true);
        assert_eq!(part, b"one\r\ntwo");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_library_run_takes_every_file_as_it_is_and_names_what_it_leaves_out() {
        use bismillah_print::{Receiver, Step};
        use std::collections::BTreeMap;

        let dir = std::env::temp_dir().join(format!("bismillah-run-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("a")).unwrap();
        let texts: [(&str, &[u8]); 2] = [
            ("a/crlf.md", b"\xef\xbb\xbfone\r\ntwo\r\n"),
            ("top.md", "بِسْمِ ٱللَّهِ\n".as_bytes()),
        ];
        for (name, bytes) in texts {
            std::fs::write(dir.join(name), bytes).unwrap();
        }
        std::fs::write(dir.join("empty.md"), b"").unwrap();
        std::fs::write(dir.join("ignored.txt"), b"not listed").unwrap();
        // Outside the library, and it must stay there.
        let outside = std::env::temp_dir().join(format!("bismillah-out-{}.md", std::process::id()));
        std::fs::write(&outside, b"secret").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("link.md")).unwrap();

        let library = Library::open(&dir).unwrap();
        let (mut playlist, job) = library_run(library, 0, 0, None).unwrap();
        assert_eq!(job.texts, 2);
        assert!(job.left_out.iter().any(|l| l.name == "empty.md"));
        assert!(!job.truncated);

        let mut receiver = Receiver::default();
        let mut got = BTreeMap::new();
        for _ in 0..200 {
            let text = playlist.next_text().unwrap();
            if let Ok(Step::Complete(received)) = receiver.receive(&text) {
                got.insert(received.name, received.bytes);
            }
        }
        assert_eq!(got.len(), 2, "{:?}", got.keys());
        for (name, bytes) in texts {
            assert_eq!(got[name], bytes, "{name}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::remove_file(&outside).unwrap();
    }

    #[test]
    fn a_paired_library_run_opens_only_with_the_phones_key() {
        use bismillah_print::{PhoneSecret, Receiver, Refusal, Step};

        let dir = std::env::temp_dir().join(format!("bismillah-sealed-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.md"), b"one\r\n").unwrap();
        let phone = PhoneSecret::generate();
        let library = Library::open(&dir).unwrap();
        let (mut playlist, job) = library_run(library, 0, 0, Some(phone.public().clone())).unwrap();
        assert_eq!(job.sealed_words, Some(phone.public().check_words()));

        let mut with_key = Receiver::default();
        with_key.set_secret(PhoneSecret::from_bytes(&phone.to_bytes()).unwrap());
        let mut without = Receiver::default();
        let (mut got, mut refused) = (None, false);
        for _ in 0..40 {
            let text = playlist.next_text().unwrap();
            if let Ok(Step::Complete(received)) = with_key.receive(&text) {
                got = Some(received.bytes);
            }
            match without.receive(&text) {
                Err(Refusal::OtherKey) => refused = true,
                Ok(Step::Complete(_)) => panic!("opened without the key"),
                _ => {}
            }
        }
        assert_eq!(got.as_deref(), Some(b"one\r\n".as_slice()));
        assert!(refused);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
