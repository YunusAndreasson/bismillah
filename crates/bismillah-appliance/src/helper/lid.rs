//! The lid. Closing it locks at once, whether or not the system sleeps: logind ignores
//! a lid closed within `HoldoffTimeoutSec=` of the last resume, and on the Dell that
//! left the document showing for 16.7 s (docs/spikes/os-suspend-lock.md).

use crate::mark;
use crate::session::Session;
use std::io::Read;
use std::sync::Arc;

const EV_SW: u16 = 0x05;
const SW_LID: u16 = 0x00;
/// `struct input_event` on 64-bit Linux: a 16-byte timeval, type, code and value.
const EVENT_SIZE: usize = 24;

/// Watches the lid switch until it goes away. Machines without one return at once.
pub fn watch(session: Arc<Session>) {
    let devices = std::fs::read_to_string("/proc/bus/input/devices").unwrap_or_default();
    let Some(handler) = lid_device(&devices) else {
        return;
    };
    let Ok(mut device) = std::fs::File::open(format!("/dev/input/{handler}")) else {
        return;
    };
    mark("lid-watched");
    let mut event = [0u8; EVENT_SIZE];
    while device.read_exact(&mut event).is_ok() {
        if lid_closed(&event) {
            mark("lid-closed");
            session.ask_lock();
        }
    }
}

/// Whether an input event says the lid closed.
fn lid_closed(event: &[u8; EVENT_SIZE]) -> bool {
    let kind = u16::from_ne_bytes([event[16], event[17]]);
    let code = u16::from_ne_bytes([event[18], event[19]]);
    let value = i32::from_ne_bytes([event[20], event[21], event[22], event[23]]);
    kind == EV_SW && code == SW_LID && value == 1
}

/// The event device of the input device that reports a lid switch (`B: SW=` with bit
/// `SW_LID`), from `/proc/bus/input/devices`.
fn lid_device(devices: &str) -> Option<String> {
    devices.split("\n\n").find_map(|block| {
        let switches = block
            .lines()
            .find_map(|l| l.strip_prefix("B: SW="))
            .and_then(|bits| u64::from_str_radix(bits.split(' ').next_back()?.trim(), 16).ok())?;
        if switches & (1 << SW_LID) == 0 {
            return None;
        }
        block
            .lines()
            .find_map(|l| l.strip_prefix("H: Handlers="))?
            .split_whitespace()
            .find(|h| h.starts_with("event"))
            .map(str::to_owned)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_lid_switch() {
        let devices = "\
I: Bus=0019 Vendor=0000 Product=0001 Version=0000
N: Name=\"Power Button\"
H: Handlers=kbd event0
B: EV=3

I: Bus=0019 Vendor=0000 Product=0005 Version=0000
N: Name=\"Lid Switch\"
P: Phys=PNP0C0D/button/input0
H: Handlers=event1
B: PROP=0
B: EV=21
B: SW=1

I: Bus=0011 Vendor=0001 Product=0001 Version=ab41
N: Name=\"AT Translated Set 2 keyboard\"
H: Handlers=sysrq kbd event2 leds
B: SW=0
";
        assert_eq!(lid_device(devices).as_deref(), Some("event1"));
        assert_eq!(lid_device("").as_deref(), None);
        // A tablet-mode switch (bit 1) alone is not a lid.
        assert_eq!(lid_device("H: Handlers=event5\nB: SW=2\n").as_deref(), None);
    }

    #[test]
    fn reads_lid_events() {
        let event = |kind: u16, code: u16, value: i32| {
            let mut e = [0u8; EVENT_SIZE];
            e[16..18].copy_from_slice(&kind.to_ne_bytes());
            e[18..20].copy_from_slice(&code.to_ne_bytes());
            e[20..24].copy_from_slice(&value.to_ne_bytes());
            e
        };
        assert!(lid_closed(&event(EV_SW, SW_LID, 1)));
        assert!(!lid_closed(&event(EV_SW, SW_LID, 0)));
        assert!(!lid_closed(&event(0x01, SW_LID, 1)));
        assert!(!lid_closed(&event(EV_SW, 0x01, 1)));
    }
}
