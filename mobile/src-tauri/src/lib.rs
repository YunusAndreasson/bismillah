mod key;
mod settings;
mod store;

use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use bismillah_print::{Receiver, Refusal, Step, digest};
use serde::Serialize;
use settings::Settings;
use store::{About, Document, Library, RunProgress};
use tauri::{AppHandle, Manager as _, State};

/// One print being gathered, however many frames it takes. The lock is held while a text
/// is stored too, and while listing, because a listing clears temporary files.
#[derive(Default)]
struct Receiving(Mutex<Receiver>);

/// What a frame did, for the quiet line. The text comes back only once it's stored.
#[derive(Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum Frame {
    Ignored,
    Receiving {
        resolved: usize,
        total: usize,
    },
    Stored {
        digest: String,
        name: String,
        selection: bool,
        bytes: usize,
        /// It came sealed to this phone's key. Otherwise a camera alone could have read it.
        sealed: bool,
        /// To read at once. A run's texts wait in the library, so `run` comes instead.
        text: Option<String>,
        run: Option<RunProgress>,
    },
}

/// Says only what the writer can act on, and never holds any of the text. In every case
/// nothing was stored.
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(rename_all = "snake_case")]
enum ReceiveError {
    #[error("the frames did not make a whole text")]
    Damaged,
    #[error("the print is in a format this app doesn't know")]
    Version,
    #[error("the text is too long")]
    TooLong,
    #[error("the text could not be stored")]
    NotStored,
    #[error("the print is sealed to another key")]
    OtherKey,
}

impl From<Refusal> for ReceiveError {
    fn from(refusal: Refusal) -> Self {
        match refusal {
            Refusal::Damaged => Self::Damaged,
            Refusal::Version => Self::Version,
            Refusal::TooLong => Self::TooLong,
            Refusal::OtherKey => Self::OtherKey,
        }
    }
}

/// Reading the library failed: the words may still be there, but they can't be shown.
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(rename_all = "snake_case")]
enum LibraryError {
    #[error("no such text")]
    Missing,
    #[error("the library could not be read or written")]
    Unavailable,
}

/// A text as it's about to be read.
#[derive(Serialize)]
struct Opened {
    text: String,
    bytes: usize,
    /// The bytes on the disk still hash to the digest they arrived under. Worked out
    /// here at every opening, so *Exact* is never remembered from an earlier time.
    exact: bool,
}

fn root(app: &AppHandle) -> Result<PathBuf, LibraryError> {
    app.path()
        .app_data_dir()
        .map_err(|_| LibraryError::Unavailable)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| u64::try_from(since.as_millis()).unwrap_or(0))
}

fn receive(
    receiving: &Mutex<Receiver>,
    root: Result<PathBuf, LibraryError>,
    text: &str,
) -> Result<Frame, ReceiveError> {
    let mut receiver = receiving.lock().unwrap_or_else(PoisonError::into_inner);
    // Without its key a sealed print is refused, so this tries again on the next frame.
    if !receiver.has_secret()
        && let Ok(root) = &root
        && let Ok(secret) = key::load_or_create(root)
    {
        receiver.set_secret(secret);
    }
    Ok(match receiver.receive(text)? {
        Step::Ignored => Frame::Ignored,
        Step::Receiving { resolved, total } => Frame::Receiving { resolved, total },
        Step::Complete(received) => {
            let root = root.map_err(|_| ReceiveError::NotStored)?;
            let library = Library::new(&root);
            let now = now_ms();
            let about = About {
                name: received.name,
                selection: received.selection,
                received_ms: now,
            };
            library
                .keep(&received.digest, &received.bytes, &about)
                .map_err(|_| ReceiveError::NotStored)?;
            let run = received
                .place
                .map(|place| {
                    library.run_arrived(&place.run, place.index, place.count, &received.digest, now)
                })
                .transpose()
                .map_err(|_| ReceiveError::NotStored)?;
            Frame::Stored {
                digest: store::hex(&received.digest),
                text: run
                    .is_none()
                    .then(|| String::from_utf8_lossy(&received.bytes).into_owned()),
                run,
                bytes: received.bytes.len(),
                sealed: received.sealed,
                name: about.name,
                selection: about.selection,
            }
        }
    })
}

/// One QR code's text, from the camera in time (mobile/PLAN.md, M2) and until then from
/// the debug hook in src/mobile. Inflating and storing take a moment, so it runs off the
/// async runtime.
#[tauri::command]
async fn receive_frame(app: AppHandle, text: String) -> Result<Frame, ReceiveError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<'_, Receiving> = app.state();
        receive(&state.0, root(&app), &text)
    })
    .await
    .map_err(|_| ReceiveError::NotStored)?
}

#[tauri::command]
async fn documents(app: AppHandle) -> Result<Vec<Document>, LibraryError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<'_, Receiving> = app.state();
        let _writers = state.0.lock().unwrap_or_else(PoisonError::into_inner);
        Library::new(&root(&app)?)
            .list()
            .map_err(|_| LibraryError::Unavailable)
    })
    .await
    .map_err(|_| LibraryError::Unavailable)?
}

#[tauri::command]
async fn document_open(app: AppHandle, id: String) -> Result<Opened, LibraryError> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = Library::new(&root(&app)?)
            .read(&id)
            .map_err(|_| LibraryError::Unavailable)?
            .ok_or(LibraryError::Missing)?;
        Ok(Opened {
            exact: store::hex(&digest(&bytes)) == id,
            text: String::from_utf8_lossy(&bytes).into_owned(),
            bytes: bytes.len(),
        })
    })
    .await
    .map_err(|_| LibraryError::Unavailable)?
}

/// What the writer types into the stick, and the words both sides then show.
#[derive(Serialize)]
struct PairingKey {
    key: String,
    words: String,
}

#[tauri::command]
async fn phone_key(app: AppHandle) -> Result<PairingKey, LibraryError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<'_, Receiving> = app.state();
        // Held so that two first uses can't each make a key.
        let _writers = state.0.lock().unwrap_or_else(PoisonError::into_inner);
        let secret = key::load_or_create(&root(&app)?).map_err(|_| LibraryError::Unavailable)?;
        Ok(PairingKey {
            key: secret.public().grouped(),
            words: secret.public().check_words(),
        })
    })
    .await
    .map_err(|_| LibraryError::Unavailable)?
}

/// The run that last gained a text, so a long scan can pick up after a restart.
#[tauri::command]
async fn run_latest(app: AppHandle) -> Result<Option<RunProgress>, LibraryError> {
    tauri::async_runtime::spawn_blocking(move || Ok(Library::new(&root(&app)?).latest_run()))
        .await
        .map_err(|_| LibraryError::Unavailable)?
}

#[tauri::command]
fn settings_get(app: AppHandle) -> Result<Settings, LibraryError> {
    Ok(settings::load(&root(&app)?))
}

#[tauri::command]
fn settings_set(app: AppHandle, settings: Settings) -> Result<(), LibraryError> {
    settings::save(&root(&app)?, &settings).map_err(|_| LibraryError::Unavailable)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Receiving::default())
        .invoke_handler(tauri::generate_handler![
            receive_frame,
            documents,
            document_open,
            run_latest,
            phone_key,
            settings_get,
            settings_set
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| panic!("the app could not start: {error}"));
}
