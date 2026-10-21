//! Switching virtual terminals, for the empty-VT fallback before sleep.

use crate::mark;
use std::os::fd::AsRawFd;

const VT_ACTIVATE: libc::c_ulong = 0x5606;
const VT_WAITACTIVE: libc::c_ulong = 0x5607;

/// Makes VT `n` the active one and waits until it is. Whether it is now active.
pub fn switch(n: u16) -> bool {
    let Ok(tty) = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/tty0")
    else {
        return false;
    };
    let fd = tty.as_raw_fd();
    let vt = libc::c_ulong::from(n);
    // SAFETY: both ioctls take the VT number as a plain integer argument and touch no
    // memory of ours; `fd` is the open console `tty` owns for the whole call.
    let switched =
        unsafe { libc::ioctl(fd, VT_ACTIVATE, vt) == 0 && libc::ioctl(fd, VT_WAITACTIVE, vt) == 0 };
    mark(&format!(
        "vt-{n}-{}",
        if switched { "active" } else { "failed" }
    ));
    switched
}
