//! How the session draws, written before it starts. Where Mesa has no hardware
//! driver for the boot display it renders in software, and WebKit's DMA-BUF renderer
//! then shows a frame only once the next input arrives: a panel or the palette stayed
//! unpainted, or the first screen white, until a key was pressed. WebKit's shared
//! memory renderer presents each frame as it is drawn.

use std::path::Path;

const ENV: &str = "/run/bismillah/display.env";
/// The display the firmware booted on (udev's link, as cage's WLR_DRM_DEVICES).
const BOOT_VGA: &str = "/dev/dri/boot-vga";
/// The kernel drivers of GPUs Mesa renders on in hardware. Any other display (a VM's
/// virtio-pci or bochs, simpledrm, a GPU too new for Debian's kernel) is drawn by
/// llvmpipe.
const HARDWARE: &[&str] = &["i915", "xe", "amdgpu", "radeon", "nouveau"];

/// Whether a display whose device has this driver is drawn in software.
pub fn software(driver: Option<&str>) -> bool {
    driver.is_none_or(|d| !HARDWARE.contains(&d))
}

/// The driver of the boot display's device: /dev/dri/boot-vga → cardN → device/driver.
fn boot_driver() -> Option<String> {
    let card = std::fs::canonicalize(BOOT_VGA).ok()?;
    let name = card.file_name()?;
    let driver =
        std::fs::read_link(Path::new("/sys/class/drm").join(name).join("device/driver")).ok()?;
    Some(driver.file_name()?.to_string_lossy().into_owned())
}

/// The session's rendering environment (`EnvironmentFile=`): empty on hardware.
pub fn write_env() -> std::io::Result<()> {
    let text = if software(boot_driver().as_deref()) {
        "WEBKIT_DISABLE_DMABUF_RENDERER=1\n"
    } else {
        ""
    };
    crate::keyboard::write_private(Path::new(ENV), text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_displays_without_a_hardware_driver_draw_in_software() {
        for driver in ["i915", "xe", "amdgpu", "radeon", "nouveau"] {
            assert!(!software(Some(driver)), "{driver}");
        }
        for driver in ["virtio-pci", "bochs-drm", "simple-framebuffer", "vmwgfx"] {
            assert!(software(Some(driver)), "{driver}");
        }
        assert!(software(None));
    }
}
