//! The phone's library. `received/<sha256>` holds a text's bytes and nothing else,
//! `about/<sha256>.json` the names it arrived under, and `runs/<id>.json` how far a *Print
//! whole library* run has got. The path a print carries never reaches the file system:
//! every path here is built from a digest or a run's ID, in hex. A folder is part of a
//! text's name, and exists only in the notes.
//!
//! Texts are never replaced, so a new print of a changed text is a new version of it. The
//! name links the versions: the stick's files carry no ID of their own, and it may not
//! add anything to them (AGENTS.md), so a renamed file starts a new document here.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::fs::{self, File};
use std::io::{self, Write as _};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// A frame of a code left on the screen repeats its text many times a minute, which isn't
/// news. Past this, the same text arriving again is what the stick now holds.
const SAME_ARRIVAL_MS: u64 = 60_000;
/// How many missing texts the phone names at once.
const LACKS_LISTED: usize = 8;

/// A name a text arrived under, and when it last did. A text whose note is lost or damaged
/// is still listed: losing a label must not lose the words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct About {
    pub name: String,
    pub selection: bool,
    pub received_ms: u64,
}

/// One text as a version of a document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Version {
    pub digest: String,
    pub bytes: u64,
    /// `None` if its note is lost or damaged.
    pub received_ms: Option<u64>,
}

/// One row in the list. The same bytes under two paths are two documents, as on the stick.
/// A selection, or a text whose name is lost, is a document of one version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Document {
    /// The path in the library, for showing only. `None` if its note is lost or damaged.
    pub name: Option<String>,
    pub selection: bool,
    /// Latest arrival first.
    pub versions: Vec<Version>,
}

/// How far a run has got, in the numbers the stick shows beside its code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RunProgress {
    pub have: usize,
    pub count: u32,
    /// The first few still missing, counted from 1.
    pub lacks: Vec<u32>,
    /// How many more are missing than `lacks` names.
    pub lacks_more: usize,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RunRecord {
    count: u32,
    updated_ms: u64,
    /// Which text each place held when it was stored.
    have: BTreeMap<u32, String>,
}

impl RunRecord {
    fn progress(&self) -> RunProgress {
        let have = self.have.range(..self.count).count();
        // Stops at the list's length, so a count that claims billions costs nothing.
        let lacks: Vec<u32> = (0..self.count)
            .filter(|index| !self.have.contains_key(index))
            .take(LACKS_LISTED)
            .map(|index| index + 1)
            .collect();
        let missing = (self.count as usize).saturating_sub(have);
        RunProgress {
            have,
            count: self.count,
            lacks_more: missing - lacks.len(),
            lacks,
        }
    }
}

pub struct Library {
    received: PathBuf,
    about: PathBuf,
    runs: PathBuf,
}

impl Library {
    pub fn new(root: &Path) -> Self {
        Self {
            received: root.join("received"),
            about: root.join("about"),
            runs: root.join("runs"),
        }
    }

    /// Keeps a verified text and the name it came under durably, or reports that it
    /// couldn't. Another name for the same bytes is added to the note, so no path is lost.
    pub fn keep(&self, digest: &[u8; 32], bytes: &[u8], about: &About) -> io::Result<()> {
        store(&self.received, digest, bytes)?;
        let note = self.about.join(format!("{}.json", hex(digest)));
        let mut arrivals = read_note(&note).unwrap_or_default();
        let same =
            |known: &&mut About| known.name == about.name && known.selection == about.selection;
        match arrivals.iter_mut().find(same) {
            Some(known)
                if about.received_ms.saturating_sub(known.received_ms) < SAME_ARRIVAL_MS =>
            {
                return Ok(());
            }
            Some(known) => known.received_ms = about.received_ms,
            None => arrivals.push(about.clone()),
        }
        fs::create_dir_all(&self.about)?;
        let json = serde_json::to_vec(&arrivals).map_err(io::Error::other)?;
        replace(&self.about, &note, &json)
    }

    /// Records that a run's place holds this text, once the text itself is durable. A kill
    /// between the two costs a place the next round fills, and never claims a text it lacks.
    pub fn run_arrived(
        &self,
        run: &[u8; 16],
        index: u32,
        count: u32,
        digest: &[u8; 32],
        now_ms: u64,
    ) -> io::Result<RunProgress> {
        let path = self.runs.join(format!("{}.json", hex(run)));
        let mut record = read_run(&path).unwrap_or_default();
        let digest = hex(digest);
        if record.count == count && record.have.get(&index) == Some(&digest) {
            return Ok(record.progress());
        }
        record.count = count;
        record.updated_ms = now_ms;
        record.have.insert(index, digest);
        fs::create_dir_all(&self.runs)?;
        let json = serde_json::to_vec(&record).map_err(io::Error::other)?;
        replace(&self.runs, &path, &json)?;
        Ok(record.progress())
    }

    /// The run that most recently gained a text, so a long scan can pick up after a restart.
    pub fn latest_run(&self) -> Option<RunProgress> {
        fs::read_dir(&self.runs)
            .ok()?
            .flatten()
            .filter_map(|file| read_run(&file.path()))
            .max_by_key(|record| record.updated_ms)
            .map(|record| record.progress())
    }

    /// Every document, latest first. Temporary files from a killed write are cleared here,
    /// and they were never reported as stored. The caller keeps other writers out.
    pub fn list(&self) -> io::Result<Vec<Document>> {
        sweep(&self.about);
        sweep(&self.runs);
        let folder = match fs::read_dir(&self.received) {
            Ok(folder) => folder,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        sweep(&self.received);
        let mut named: BTreeMap<String, Vec<Version>> = BTreeMap::new();
        let mut documents = Vec::new();
        for file in folder {
            let file = file?;
            let name = file.file_name();
            let Some(digest) = name.to_str().filter(|n| is_digest(n)) else {
                continue;
            };
            let bytes = file.metadata()?.len();
            let version = |received_ms| Version {
                digest: digest.to_owned(),
                bytes,
                received_ms,
            };
            let arrivals = read_note(&self.about.join(format!("{digest}.json")));
            let arrivals = arrivals.filter(|arrivals| !arrivals.is_empty());
            let Some(arrivals) = arrivals else {
                documents.push(Document {
                    name: None,
                    selection: false,
                    versions: vec![version(None)],
                });
                continue;
            };
            for about in arrivals {
                if about.selection {
                    documents.push(Document {
                        name: Some(about.name),
                        selection: true,
                        versions: vec![version(Some(about.received_ms))],
                    });
                } else {
                    named
                        .entry(about.name)
                        .or_default()
                        .push(version(Some(about.received_ms)));
                }
            }
        }
        documents.extend(named.into_iter().map(|(name, mut versions)| {
            versions.sort_by(|a, b| {
                b.received_ms
                    .cmp(&a.received_ms)
                    .then_with(|| a.digest.cmp(&b.digest))
            });
            Document {
                name: Some(name),
                selection: false,
                versions,
            }
        }));
        let latest = |document: &Document| document.versions.first().and_then(|v| v.received_ms);
        documents.sort_by(|a, b| {
            latest(b)
                .cmp(&latest(a))
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| first_digest(a).cmp(first_digest(b)))
        });
        Ok(documents)
    }

    /// A text's bytes. `None` if `digest` isn't one, or there's no such text. The caller
    /// compares them with the digest before saying *Exact*.
    pub fn read(&self, digest: &str) -> io::Result<Option<Vec<u8>>> {
        if !is_digest(digest) {
            return Ok(None);
        }
        match fs::read(self.received.join(digest)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }
}

/// Lower-case hex SHA-256 and nothing else, so it can't name anything outside the folder.
pub fn is_digest(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn first_digest(document: &Document) -> &str {
    document
        .versions
        .first()
        .map_or("", |version| &version.digest)
}

pub fn hex(digest: &[u8]) -> String {
    digest
        .iter()
        .fold(String::with_capacity(digest.len() * 2), |mut out, b| {
            let _ = write!(out, "{b:02x}");
            out
        })
}

fn read_note(path: &Path) -> Option<Vec<About>> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn read_run(path: &Path) -> Option<RunRecord> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// Writes `path` atomically: the old file or the new one survives a kill, never half.
pub fn replace(folder: &Path, path: &Path, bytes: &[u8]) -> io::Result<()> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::other("no file name"))?;
    let temporary = folder.join(format!(".{name}.part"));
    let written = write(&temporary, bytes)
        .and_then(|()| fs::rename(&temporary, path))
        .and_then(|()| File::open(folder)?.sync_all());
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written
}

fn sweep(folder: &Path) {
    let Ok(files) = fs::read_dir(folder) else {
        return;
    };
    for file in files.flatten() {
        let name = file.file_name();
        if name
            .to_str()
            .is_some_and(|n| n.starts_with('.') && n.ends_with(".part"))
        {
            let _ = fs::remove_file(file.path());
        }
    }
}

/// Stores `bytes` durably, or leaves nothing behind. Writes to a temporary name, flushes,
/// renames, flushes the folder, then reads the file back: *Exact* describes what's on
/// the disk, not what was in memory.
fn store(folder: &Path, digest: &[u8; 32], bytes: &[u8]) -> io::Result<PathBuf> {
    fs::create_dir_all(folder)?;
    let name = hex(digest);
    let path = folder.join(&name);
    // The same digest is the same text, already kept. A damaged copy gets replaced.
    if fs::read(&path).is_ok_and(|kept| kept == bytes) {
        return Ok(path);
    }
    let temporary = folder.join(format!(".{name}.part"));
    let written = write(&temporary, bytes)
        .and_then(|()| fs::rename(&temporary, &path))
        .and_then(|()| File::open(folder)?.sync_all())
        .and_then(|()| {
            if fs::read(&path)? == bytes {
                Ok(())
            } else {
                Err(io::Error::other("the stored text differs"))
            }
        });
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary);
        let _ = fs::remove_file(&path);
        return Err(error);
    }
    Ok(path)
}

fn write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt as _;

    /// A fresh folder under the build's own directory, as /tmp has a quota here.
    fn scratch(test: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/store-tests")
            .join(test);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const DIGEST: [u8; 32] = [0xab; 32];

    #[test]
    fn keeps_the_bytes_exactly_under_the_digest() {
        let dir = scratch("exact");
        let bytes = b"\xef\xbb\xbfone\r\ntwo\xd9\x91\xd9\x8e\0";
        let path = store(&dir, &DIGEST, bytes).unwrap();
        assert_eq!(path.file_name().unwrap().to_str().unwrap(), "ab".repeat(32));
        assert_eq!(fs::read(path).unwrap(), bytes);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn storing_again_changes_nothing_and_a_damaged_copy_is_replaced() {
        let dir = scratch("again");
        let path = store(&dir, &DIGEST, b"text").unwrap();
        store(&dir, &DIGEST, b"text").unwrap();
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::write(&path, b"tex").unwrap();
        store(&dir, &DIGEST, b"text").unwrap();
        assert_eq!(fs::read(path).unwrap(), b"text");
    }

    #[test]
    fn a_folder_that_refuses_writes_reports_it_and_keeps_nothing() {
        let dir = scratch("read-only");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        let result = store(&dir, &DIGEST, b"text");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    }

    /// A disk that fills during the write: the temporary name leads to /dev/full.
    #[test]
    fn a_full_disk_reports_it_and_keeps_nothing() {
        let dir = scratch("full");
        let temporary = dir.join(format!(".{}.part", hex(&DIGEST)));
        std::os::unix::fs::symlink("/dev/full", &temporary).unwrap();
        let error = store(&dir, &DIGEST, b"text").unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::StorageFull);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    }

    fn about(name: &str, received_ms: u64) -> About {
        About {
            name: name.to_owned(),
            selection: false,
            received_ms,
        }
    }

    fn names(library: &Library) -> Vec<String> {
        let list = library.list().unwrap();
        list.iter().map(|d| d.name.clone().unwrap()).collect()
    }

    #[test]
    fn lists_documents_latest_first() {
        let root = scratch("list");
        let library = Library::new(&root);
        assert_eq!(library.list().unwrap(), []);
        library
            .keep(&[1; 32], b"old", &about("old.md", 10))
            .unwrap();
        library
            .keep(&[2; 32], b"new", &about("new.md", 20))
            .unwrap();
        assert_eq!(names(&library), ["new.md", "old.md"]);
        assert_eq!(library.list().unwrap()[1].versions[0].bytes, 3);
    }

    #[test]
    fn a_changed_text_is_a_new_version_and_never_replaces_the_old() {
        let root = scratch("versions");
        let library = Library::new(&root);
        library
            .keep(&[1; 32], b"first", &about("a/ch.md", 10))
            .unwrap();
        library
            .keep(&[2; 32], b"second", &about("a/ch.md", 20))
            .unwrap();
        library
            .keep(&[3; 32], b"elsewhere", &about("b/ch.md", 5))
            .unwrap();
        let list = library.list().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name.as_deref(), Some("a/ch.md"));
        let digests: Vec<_> = list[0].versions.iter().map(|v| v.digest.clone()).collect();
        assert_eq!(digests, [hex(&[2; 32]), hex(&[1; 32])]);
        assert_eq!(library.read(&hex(&[1; 32])).unwrap().unwrap(), b"first");
    }

    /// The stick went back to an older text, so that is what it now holds.
    #[test]
    fn an_old_text_printed_again_is_the_latest_but_a_code_left_on_screen_is_not_news() {
        let root = scratch("printed-again");
        let library = Library::new(&root);
        let later = SAME_ARRIVAL_MS * 2;
        library
            .keep(&[1; 32], b"first", &about("a.md", 10))
            .unwrap();
        library
            .keep(&[2; 32], b"second", &about("a.md", later))
            .unwrap();
        let note = root.join("about").join(format!("{}.json", hex(&[1; 32])));
        let written = fs::read(&note).unwrap();
        library
            .keep(&[1; 32], b"first", &about("a.md", 20))
            .unwrap();
        assert_eq!(fs::read(&note).unwrap(), written);
        assert_eq!(library.list().unwrap()[0].versions[0].digest, hex(&[2; 32]));
        library
            .keep(&[1; 32], b"first", &about("a.md", later * 2))
            .unwrap();
        assert_eq!(library.list().unwrap()[0].versions[0].digest, hex(&[1; 32]));
    }

    /// A whole library can hold two files with the same words, and both must be kept.
    #[test]
    fn the_same_bytes_under_two_paths_are_two_documents() {
        let root = scratch("twice");
        let library = Library::new(&root);
        library
            .keep(&DIGEST, b"same", &about("a/one.md", 1))
            .unwrap();
        library
            .keep(&DIGEST, b"same", &about("b/one.md", 2))
            .unwrap();
        assert_eq!(names(&library), ["b/one.md", "a/one.md"]);
        assert_eq!(fs::read_dir(root.join("received")).unwrap().count(), 1);
    }

    #[test]
    fn each_selection_stands_alone() {
        let root = scratch("selections");
        let library = Library::new(&root);
        let part = |ms| About {
            selection: true,
            ..about("a.md", ms)
        };
        library.keep(&[1; 32], b"one", &part(1)).unwrap();
        library.keep(&[2; 32], b"two", &part(2)).unwrap();
        library.keep(&[3; 32], b"whole", &about("a.md", 3)).unwrap();
        let list = library.list().unwrap();
        assert_eq!(list.len(), 3);
        assert!(list.iter().all(|d| d.versions.len() == 1));
    }

    #[test]
    fn a_name_can_hold_anything_because_it_never_becomes_a_path() {
        let root = scratch("hostile");
        let library = Library::new(&root);
        let name = "../../../etc/passwd\\\u{202e}\n\0";
        library.keep(&DIGEST, b"text", &about(name, 1)).unwrap();
        library.run_arrived(&[9; 16], 0, 2, &DIGEST, 1).unwrap();
        assert_eq!(names(&library), [name]);
        let mut found: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .map(|f| f.unwrap().file_name().into_string().unwrap())
            .collect();
        found.sort();
        assert_eq!(found, ["about", "received", "runs"]);
    }

    #[test]
    fn a_lost_or_damaged_note_never_loses_the_text() {
        let root = scratch("note");
        let library = Library::new(&root);
        library.keep(&[1; 32], b"one", &about("one.md", 1)).unwrap();
        library.keep(&[2; 32], b"two", &about("two.md", 2)).unwrap();
        fs::write(
            root.join("about").join(format!("{}.json", hex(&[1; 32]))),
            b"{",
        )
        .unwrap();
        fs::remove_file(root.join("about").join(format!("{}.json", hex(&[2; 32])))).unwrap();
        let list = library.list().unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().all(|document| document.name.is_none()));
        assert_eq!(library.read(&hex(&[1; 32])).unwrap().unwrap(), b"one");
    }

    #[test]
    fn a_killed_write_leaves_nothing_listed_and_is_cleared() {
        let root = scratch("killed");
        let library = Library::new(&root);
        library
            .keep(&[1; 32], b"kept", &about("kept.md", 1))
            .unwrap();
        let received = root.join("received");
        let half = received.join(format!(".{}.part", hex(&[2; 32])));
        fs::write(&half, b"hal").unwrap();
        let list = library.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].versions[0].digest, hex(&[1; 32]));
        assert!(!half.exists());
    }

    #[test]
    fn a_run_says_what_it_lacks_in_the_sticks_numbers() {
        let root = scratch("run");
        let library = Library::new(&root);
        assert_eq!(library.latest_run(), None);
        let run = [7; 16];
        let progress = library.run_arrived(&run, 1, 3, &[1; 32], 1).unwrap();
        assert_eq!((progress.have, progress.count), (1, 3));
        assert_eq!(progress.lacks, [1, 3]);
        library.run_arrived(&run, 1, 3, &[1; 32], 2).unwrap();
        library.run_arrived(&run, 0, 3, &[2; 32], 3).unwrap();
        let progress = library.run_arrived(&run, 2, 3, &[3; 32], 4).unwrap();
        assert_eq!(progress.have, 3);
        assert_eq!(progress.lacks, [] as [u32; 0]);
        assert_eq!(library.latest_run(), Some(progress));
    }

    #[test]
    fn a_run_survives_a_restart_and_the_latest_one_is_found() {
        let root = scratch("run-restart");
        Library::new(&root)
            .run_arrived(&[1; 16], 0, 2, &[1; 32], 1)
            .unwrap();
        Library::new(&root)
            .run_arrived(&[2; 16], 4, 9, &[2; 32], 2)
            .unwrap();
        let progress = Library::new(&root).latest_run().unwrap();
        assert_eq!((progress.have, progress.count), (1, 9));
        assert_eq!(progress.lacks.len(), LACKS_LISTED);
        assert_eq!(progress.lacks_more, 0);
    }

    #[test]
    fn a_run_claiming_billions_of_texts_costs_nothing() {
        let root = scratch("run-huge");
        let library = Library::new(&root);
        let progress = library
            .run_arrived(&[1; 16], 0, u32::MAX, &[1; 32], 1)
            .unwrap();
        assert_eq!(progress.lacks.len(), LACKS_LISTED);
        assert_eq!(progress.lacks_more, u32::MAX as usize - 1 - LACKS_LISTED);
    }

    #[test]
    fn a_damaged_run_record_starts_over_rather_than_losing_a_text() {
        let root = scratch("run-damaged");
        let library = Library::new(&root);
        library.run_arrived(&[1; 16], 0, 2, &[1; 32], 1).unwrap();
        fs::write(
            root.join("runs").join(format!("{}.json", hex(&[1; 16]))),
            b"{",
        )
        .unwrap();
        assert_eq!(library.latest_run(), None);
        let progress = library.run_arrived(&[1; 16], 1, 2, &[2; 32], 2).unwrap();
        assert_eq!(progress.lacks, [1]);
    }

    #[test]
    fn only_a_digest_reads_a_text() {
        let root = scratch("read");
        let library = Library::new(&root);
        library.keep(&DIGEST, b"text", &about("a.md", 1)).unwrap();
        assert_eq!(library.read(&hex(&DIGEST)).unwrap().unwrap(), b"text");
        for bad in [
            "",
            "..",
            "../about",
            "a/b",
            &"A".repeat(64),
            &"g".repeat(64),
        ] {
            assert_eq!(library.read(bad).unwrap(), None, "{bad}");
        }
        assert_eq!(library.read(&"0".repeat(64)).unwrap(), None);
    }

    /// A rename that can't happen, as when something else holds the name: a folder here.
    #[test]
    fn a_failed_rename_leaves_no_temporary_behind() {
        let dir = scratch("rename");
        let blocker = dir.join(hex(&DIGEST));
        fs::create_dir(&blocker).unwrap();
        fs::write(blocker.join("inside"), b"x").unwrap();
        assert!(store(&dir, &DIGEST, b"text").is_err());
        assert!(!dir.join(format!(".{}.part", hex(&DIGEST))).exists());
    }
}
