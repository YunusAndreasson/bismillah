//! Every per-OS difference in opening a stick, in one place. The install scripts have
//! already chosen the disk and checked it (USB, not the system's, unmounted); this
//! opens it so that reads come from the stick itself, not from this computer's cache
//! of it, and refuses anything that isn't a disk.

use std::fs::{File, OpenOptions};
use std::io;

use crate::Error;

/// Linux: the block device, uncached (`O_DIRECT`), and exclusively (`O_EXCL` on a block
/// device fails while any of its partitions is mounted).
#[cfg(target_os = "linux")]
pub fn open_device(path: &str, write: bool) -> Result<File, Error> {
    use std::os::unix::fs::{FileTypeExt, OpenOptionsExt};
    #[cfg(target_arch = "x86_64")]
    const O_DIRECT: i32 = 0o40000;
    #[cfg(target_arch = "aarch64")]
    const O_DIRECT: i32 = 0o200000;
    const O_EXCL: i32 = 0o200;
    let file = OpenOptions::new()
        .read(true)
        .write(write)
        .custom_flags(O_DIRECT | O_EXCL)
        .open(path)
        .map_err(|e| opened(path, &e))?;
    if !file.metadata()?.file_type().is_block_device() {
        return Err(Error::Refused(format!("{path} isn't a disk")));
    }
    Ok(file)
}

/// macOS: the raw disk (`/dev/rdiskN`), which has no cache.
#[cfg(target_os = "macos")]
pub fn open_device(path: &str, write: bool) -> Result<File, Error> {
    use std::os::unix::fs::FileTypeExt;
    if !path.starts_with("/dev/rdisk") {
        return Err(Error::Refused(format!(
            "{path} isn't a raw disk (/dev/rdiskN)"
        )));
    }
    let file = OpenOptions::new()
        .read(true)
        .write(write)
        .open(path)
        .map_err(|e| opened(path, &e))?;
    if !file.metadata()?.file_type().is_char_device() {
        return Err(Error::Refused(format!("{path} isn't a disk")));
    }
    Ok(file)
}

/// Windows: `\\.\PhysicalDriveN`, uncached and written through. The script has taken
/// the disk offline first, so Windows has no volume on it to guard or to mount.
#[cfg(windows)]
pub fn open_device(path: &str, write: bool) -> Result<File, Error> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_NO_BUFFERING: u32 = 0x2000_0000;
    const FILE_FLAG_WRITE_THROUGH: u32 = 0x8000_0000;
    let number = path.strip_prefix(r"\\.\PhysicalDrive").unwrap_or("");
    if number.is_empty() || !number.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Error::Refused(format!(
            "{path} isn't a disk (\\\\.\\PhysicalDriveN)"
        )));
    }
    OpenOptions::new()
        .read(true)
        .write(write)
        .custom_flags(FILE_FLAG_NO_BUFFERING | FILE_FLAG_WRITE_THROUGH)
        .open(path)
        .map_err(|e| opened(path, &e))
}

fn opened(path: &str, e: &io::Error) -> Error {
    if e.kind() == io::ErrorKind::PermissionDenied {
        Error::Refused(format!(
            "{path}: not allowed to open it (run the command again)"
        ))
    } else if e.raw_os_error() == Some(16) && cfg!(target_os = "linux") {
        Error::Refused(format!(
            "{path} is still in use: one of its partitions is mounted"
        ))
    } else {
        Error::Refused(format!("{path}: {e}"))
    }
}

/// Flushing a disk: `F_FULLFSYNC` on macOS, which a raw disk may not support. Its writes
/// are unbuffered, and everything is read back anyway.
pub fn sync(file: &File) -> io::Result<()> {
    match file.sync_all() {
        Err(_) if cfg!(target_os = "macos") => Ok(()),
        other => other,
    }
}
