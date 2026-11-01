//! This phone's key (ADR-0023): made once, kept in the app's private folder, which backup
//! and device transfer both leave out. It sits beside the texts it opens, which are stored
//! as plain bytes, so wrapping it in the system's keystore would protect nothing more.

use std::fs;
use std::io;
use std::path::Path;

use bismillah_print::PhoneSecret;

use crate::store;

const FILE: &str = "phone-secret";

/// The key, made now if there is none. A file that holds no key can't open anything, so
/// it's replaced, and prints sealed to the old key are refused with a word about pairing.
pub fn load_or_create(root: &Path) -> io::Result<PhoneSecret> {
    let path = root.join(FILE);
    match fs::read(&path) {
        Ok(bytes) => {
            if let Some(secret) = PhoneSecret::from_bytes(&bytes) {
                return Ok(secret);
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        // It may be there and fine, so an error here must not replace it.
        Err(error) => return Err(error),
    }
    let secret = PhoneSecret::generate();
    fs::create_dir_all(root)?;
    store::replace(root, &path, &secret.to_bytes())?;
    Ok(secret)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt as _;
    use std::path::PathBuf;

    fn scratch(test: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/key-tests")
            .join(test);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn is_made_once_and_stays_the_same() {
        let root = scratch("once");
        let first = load_or_create(&root).unwrap();
        let again = load_or_create(&root).unwrap();
        assert_eq!(first.public().text(), again.public().text());
        assert_eq!(first.to_bytes(), fs::read(root.join(FILE)).unwrap());
    }

    #[test]
    fn a_damaged_file_gives_a_new_key() {
        let root = scratch("damaged");
        let first = load_or_create(&root).unwrap();
        fs::write(root.join(FILE), b"not a key").unwrap();
        let second = load_or_create(&root).unwrap();
        assert_ne!(first.public().text(), second.public().text());
    }

    /// A key that can't be read may still be good, so it's never replaced for that.
    #[test]
    fn a_key_that_cant_be_read_is_not_replaced() {
        let root = scratch("unreadable");
        fs::create_dir(root.join(FILE)).unwrap();
        assert!(load_or_create(&root).is_err());
        assert!(root.join(FILE).is_dir());
    }

    #[test]
    fn a_folder_that_refuses_writes_reports_it_and_keeps_nothing() {
        let root = scratch("read-only");
        fs::set_permissions(&root, fs::Permissions::from_mode(0o555)).unwrap();
        let result = load_or_create(&root);
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    }
}
