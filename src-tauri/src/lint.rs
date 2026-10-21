//! Spelling and grammar in the app (ARCHITECTURE.md §7): one long-lived thread owns the
//! checker, because Harper's rule group mutates its caches as it works, and the
//! writer's personal dictionary lives in `dictionary.txt` beside `settings.toml`.
//!
//! The frontend keeps at most one request in flight and sends only the blocks that
//! changed, so requests never queue up here; each carries the editor's revision, which
//! comes back with the results so the editor can drop any that are stale.

use std::fs;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Mutex, MutexGuard};
use std::time::SystemTime;

use bismillah_lint::personal::{self, WordProblem};
use bismillah_lint::{ARABIC_BUDGET, Block, Diagnostic, Dialect, Lang, Linter, Options};
use serde::Serialize;

use crate::documents::{self, NO_FAULTS, SaveError};

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

enum Job {
    Check {
        blocks: Vec<Block>,
        options: Options,
        reply: mpsc::Sender<Vec<Vec<Diagnostic>>>,
    },
    /// The personal dictionary changed.
    Words(Vec<String>),
}

/// Work for the suggestion thread.
enum Ask {
    /// The English dictionary exists: build the search automata now, not on the first
    /// popover.
    Warm(Dialect),
    Suggest {
        word: String,
        lang: Lang,
        dialect: Dialect,
        reply: mpsc::Sender<Vec<String>>,
    },
}

/// Why a word wasn't added to the personal dictionary.
#[derive(Clone, Debug, PartialEq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AddWordError {
    #[error("that isn't one word")]
    InvalidWord { reason: &'static str },
    #[error("the dictionary wasn't saved: {error}")]
    NotSaved { error: SaveError },
}

/// The checker stopped (it never should): the editor stops asking.
#[derive(Clone, Debug, PartialEq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LintError {
    #[error("the checker isn't available")]
    Unavailable,
}

/// `dictionary.txt`: the writer's file, read when it changes and appended to, never
/// rewritten (their notes and order stay).
struct Words {
    path: PathBuf,
    modified: Option<SystemTime>,
    list: Vec<String>,
}

impl Words {
    fn load(path: PathBuf) -> Self {
        let mut words = Words {
            path,
            modified: None,
            list: Vec::new(),
        };
        words.read();
        words
    }

    fn read(&mut self) {
        self.modified = fs::metadata(&self.path).and_then(|m| m.modified()).ok();
        self.list = fs::read_to_string(&self.path)
            .map(|text| personal::parse(&text))
            .unwrap_or_default();
    }

    /// Re-reads the file if it changed since it was last read or written. True if the
    /// list of words changed.
    fn refresh(&mut self) -> bool {
        let modified = fs::metadata(&self.path).and_then(|m| m.modified()).ok();
        if modified == self.modified {
            return false;
        }
        let before = std::mem::take(&mut self.list);
        self.read();
        before != self.list
    }

    /// Appends `word` (already validated) as a line of its own. True if it was new.
    fn add(&mut self, word: &str) -> Result<bool, SaveError> {
        // The file as it is now, in case it was edited since it was read.
        let mut bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(SaveError::from_io(&e)),
        };
        self.list = personal::parse(&String::from_utf8_lossy(&bytes));
        if self.list.iter().any(|w| w == word) {
            return Ok(false);
        }
        if !bytes.is_empty() && !bytes.ends_with(b"\n") {
            bytes.push(b'\n');
        }
        bytes.extend_from_slice(word.as_bytes());
        bytes.push(b'\n');
        let dir = self.path.parent().unwrap_or(std::path::Path::new("."));
        fs::create_dir_all(dir).map_err(|e| SaveError::from_io(&e))?;
        let permissions = fs::metadata(&self.path).ok().map(|m| m.permissions());
        documents::write_atomic(&self.path, &bytes, permissions, NO_FAULTS)
            .map_err(|e| SaveError::from_io(&e))?;
        self.modified = fs::metadata(&self.path).and_then(|m| m.modified()).ok();
        self.list.push(word.to_string());
        Ok(true)
    }
}

pub struct Checking {
    jobs: mpsc::Sender<Job>,
    asks: mpsc::Sender<Ask>,
    words: Mutex<Words>,
}

impl Checking {
    /// Starts the checker's thread and the suggestion thread. Corrections get a long-lived
    /// thread of their own because Harper keeps its search automata per thread (1–2 s to
    /// build), so a fresh thread for each request would pay that again and again.
    /// Nothing heavy happens on the caller's thread.
    pub fn start(dictionary: PathBuf) -> Self {
        let words = Words::load(dictionary);
        let mut linter = Linter::new(words.list.clone());
        let suggester = linter.suggester();
        let (asks, questions) = mpsc::channel::<Ask>();
        let suggesting = std::thread::Builder::new()
            .name("bismillah-suggest".into())
            .spawn(move || {
                for ask in questions {
                    match ask {
                        Ask::Warm(dialect) => {
                            let _ = suggester.suggest("qxzvkj", Lang::En, dialect, ARABIC_BUDGET);
                        }
                        Ask::Suggest {
                            word,
                            lang,
                            dialect,
                            reply,
                        } => {
                            let found = catch_unwind(AssertUnwindSafe(|| {
                                suggester.suggest(&word, lang, dialect, ARABIC_BUDGET)
                            }))
                            .unwrap_or_default();
                            let _ = reply.send(found);
                        }
                    }
                }
            });
        if let Err(e) = suggesting {
            eprintln!("bismillah: couldn't start the suggestions: {e}");
        }
        let warm_suggestions = asks.clone();
        let (jobs, inbox) = mpsc::channel::<Job>();
        let spawned = std::thread::Builder::new()
            .name("bismillah-lint".into())
            .spawn(move || {
                let mut warm = false;
                for job in inbox {
                    match job {
                        Job::Check {
                            blocks,
                            options,
                            reply,
                        } => {
                            let found = blocks
                                .iter()
                                .map(|block| {
                                    // A checker bug costs one block's underlines, never the app.
                                    catch_unwind(AssertUnwindSafe(|| linter.check(block, &options)))
                                        .unwrap_or_else(|_| {
                                            eprintln!("bismillah: the checker failed on a block");
                                            Vec::new()
                                        })
                                })
                                .collect();
                            let _ = reply.send(found);
                            // Keep corrections ready after English is actually used.
                            // Empty, disabled and Arabic-only sessions must not build
                            // English dictionaries, grammar or search automata on idle.
                            if !warm && linter.english_ready() {
                                let _ = warm_suggestions.send(Ask::Warm(options.dialect));
                                warm = true;
                            }
                        }
                        Job::Words(list) => linter.set_personal(list),
                    }
                }
            });
        if let Err(e) = spawned {
            eprintln!("bismillah: couldn't start the checker: {e}");
        }
        Checking {
            jobs,
            asks,
            words: Mutex::new(words),
        }
    }

    /// Queues a check; the answer arrives on the returned channel, one list per block.
    pub fn check(
        &self,
        blocks: Vec<Block>,
        options: Options,
    ) -> Result<mpsc::Receiver<Vec<Vec<Diagnostic>>>, LintError> {
        let (reply, answer) = mpsc::channel();
        self.jobs
            .send(Job::Check {
                blocks,
                options,
                reply,
            })
            .map_err(|_| LintError::Unavailable)?;
        Ok(answer)
    }

    /// Queues a search for corrections; they arrive on the returned channel.
    pub fn suggest(
        &self,
        word: String,
        lang: Lang,
        dialect: Dialect,
    ) -> Result<mpsc::Receiver<Vec<String>>, LintError> {
        let (reply, answer) = mpsc::channel();
        self.asks
            .send(Ask::Suggest {
                word,
                lang,
                dialect,
                reply,
            })
            .map_err(|_| LintError::Unavailable)?;
        Ok(answer)
    }

    /// Adds a word to `dictionary.txt` and the checker. A word already there is fine.
    pub fn add_word(&self, word: &str) -> Result<(), AddWordError> {
        let word = personal::validate(word).map_err(|problem| AddWordError::InvalidWord {
            reason: match problem {
                WordProblem::Empty => "empty",
                WordProblem::NotOneWord => "not_one_word",
                WordProblem::TooLong => "too_long",
            },
        })?;
        let mut words = lock(&self.words);
        let added = words
            .add(word)
            .map_err(|error| AddWordError::NotSaved { error })?;
        if added {
            let _ = self.jobs.send(Job::Words(words.list.clone()));
        }
        Ok(())
    }

    /// Picks up edits the writer made to `dictionary.txt` in another program (on window
    /// focus; no polling). True if its words changed.
    pub fn refresh(&self) -> bool {
        let mut words = lock(&self.words);
        let changed = words.refresh();
        if changed {
            let _ = self.jobs.send(Job::Words(words.list.clone()));
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Scratch;
    use bismillah_lint::Kind;
    use std::time::Duration;

    fn options() -> Options {
        Options {
            spelling: true,
            grammar: true,
            dialect: Dialect::British,
            lang: None,
        }
    }

    fn block(text: &str) -> Block {
        Block {
            text: text.into(),
            ..Default::default()
        }
    }

    fn check(checking: &Checking, text: &str) -> Vec<Diagnostic> {
        let answer = checking
            .check(vec![block(text)], options())
            .expect("running");
        let mut blocks = answer
            .recv_timeout(Duration::from_secs(30))
            .expect("answered");
        blocks.pop().expect("one block")
    }

    #[test]
    fn checks_blocks_on_its_own_thread() {
        let scratch = Scratch::new();
        let checking = Checking::start(scratch.path().join("dictionary.txt"));
        let answer = checking
            .check(
                vec![block("I will recieve it."), block("This is a apple.")],
                options(),
            )
            .expect("running");
        let found = answer
            .recv_timeout(Duration::from_secs(30))
            .expect("answered");
        assert_eq!(found.len(), 2);
        assert_eq!(found[0][0].kind, Kind::Spelling);
        assert_eq!(found[1][0].kind, Kind::Grammar);
    }

    #[test]
    fn finds_corrections_on_the_suggestion_thread() {
        let scratch = Scratch::new();
        let checking = Checking::start(scratch.path().join("dictionary.txt"));
        // The English dictionary is built by the first check.
        assert_eq!(check(&checking, "I will recieve it.").len(), 1);
        let answer = checking
            .suggest("recieve".into(), Lang::En, Dialect::British)
            .expect("running");
        let found = answer
            .recv_timeout(Duration::from_secs(30))
            .expect("answered");
        assert_eq!(found.first().map(String::as_str), Some("receive"));
    }

    #[test]
    fn adds_words_as_new_lines_keeping_the_file() {
        let scratch = Scratch::new();
        let path = scratch.file("dictionary.txt", b"# my words\nIbn");
        let checking = Checking::start(path.clone());
        assert_eq!(check(&checking, "Ibn Taymiyya wrote it.").len(), 1);
        checking.add_word(" Taymiyya ").expect("added");
        checking
            .add_word("Taymiyya")
            .expect("already there is fine");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "# my words\nIbn\nTaymiyya\n"
        );
        assert!(check(&checking, "Ibn Taymiyya wrote it.").is_empty());
    }

    #[test]
    fn creates_the_file_and_its_folder_on_the_first_word() {
        let scratch = Scratch::new();
        let path = scratch.path().join("conf/dictionary.txt");
        let checking = Checking::start(path.clone());
        checking.add_word("bismillah").expect("added");
        assert_eq!(fs::read_to_string(&path).unwrap(), "bismillah\n");
    }

    #[test]
    fn refuses_what_isnt_one_word() {
        let scratch = Scratch::new();
        let checking = Checking::start(scratch.path().join("dictionary.txt"));
        assert_eq!(
            checking.add_word("two words"),
            Err(AddWordError::InvalidWord {
                reason: "not_one_word"
            })
        );
        assert_eq!(
            checking.add_word("  "),
            Err(AddWordError::InvalidWord { reason: "empty" })
        );
        assert!(scratch.entries().is_empty(), "nothing written");
    }

    #[test]
    fn a_failed_write_says_so_and_changes_nothing() {
        let scratch = Scratch::new();
        // The dictionary's folder is a file, so the write can't happen.
        let blocker = scratch.file("conf", b"not a folder");
        let checking = Checking::start(blocker.join("dictionary.txt"));
        assert!(matches!(
            checking.add_word("Taymiyya"),
            Err(AddWordError::NotSaved { .. })
        ));
        assert_eq!(fs::read(&blocker).unwrap(), b"not a folder");
        assert_eq!(check(&checking, "Taymiyya wrote it.").len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_folder_fails_visibly() {
        use std::os::unix::fs::PermissionsExt;
        let scratch = Scratch::new();
        let dir = scratch.path().join("conf");
        fs::create_dir(&dir).unwrap();
        fs::write(dir.join("dictionary.txt"), "Ibn\n").unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
        // Root (the offline e2e namespace) ignores permission bits.
        if fs::write(dir.join("probe"), "").is_ok() {
            let _ = fs::remove_file(dir.join("probe"));
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
            return;
        }
        let checking = Checking::start(dir.join("dictionary.txt"));
        let result = checking.add_word("Taymiyya");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(
            result,
            Err(AddWordError::NotSaved {
                error: SaveError::PermissionDenied
            })
        );
        assert_eq!(
            fs::read_to_string(dir.join("dictionary.txt")).unwrap(),
            "Ibn\n"
        );
    }

    #[test]
    fn picks_up_edits_made_in_another_program() {
        let scratch = Scratch::new();
        let path = scratch.file("dictionary.txt", b"Ibn\n");
        let checking = Checking::start(path.clone());
        assert!(!checking.refresh());
        fs::write(&path, b"Ibn\nTaymiyya\n").unwrap();
        let later = SystemTime::now() + Duration::from_secs(2);
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(later)
            .unwrap();
        assert!(checking.refresh());
        assert!(check(&checking, "Ibn Taymiyya wrote it.").is_empty());
    }
}
