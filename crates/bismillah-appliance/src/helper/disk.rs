//! Which partition is this stick's home (os/PLAN.md, *Which partition*), found without
//! labels (docs/spikes/os-boot-device-binding.md):
//! 1. the root disk: the disk under the dm-verity root's data and hash partitions
//! 2. the loader disk: the one disk holding systemd-boot's partition
//!    (`LoaderDevicePartUUID`), which must be the root disk
//! 3. home: the one partition of the GPT home type on that disk.
//!
//! Any disagreement refuses everything, so a second stick or a laptop disk with a
//! look-alike partition is never touched.

use bismillah_appliance::Trouble;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The Discoverable Partitions Specification's home type.
pub const HOME_TYPE: &str = "933ac7e1-2eb4-4f13-b844-0e14e2aef915";

const LOADER_VAR: &str =
    "/sys/firmware/efi/efivars/LoaderDevicePartUUID-4a67b082-0a4c-41cf-b6c7-440b29bb8c4f";

#[derive(Debug, Clone, Deserialize)]
pub struct Part {
    pub name: String,
    pub pkname: Option<String>,
    pub partuuid: Option<String>,
    pub parttype: Option<String>,
}

#[derive(Deserialize)]
struct Lsblk {
    blockdevices: Vec<Part>,
}

/// This stick's home partition, e.g. `/dev/sda4`.
pub fn home() -> Result<PathBuf, Trouble> {
    let root_disks = root_disks().ok_or(Trouble::NoBootDisk)?;
    let loader = loader_partuuid().ok_or(Trouble::NoBootDisk)?;
    let parts = partitions().ok_or(Trouble::NoBootDisk)?;
    decide(&root_disks, &loader, &parts).map(|name| Path::new("/dev").join(name))
}

/// The lookup's rules, apart from where its facts come from.
pub fn decide(root_disks: &[String], loader: &str, parts: &[Part]) -> Result<String, Trouble> {
    let [root_disk] = root_disks else {
        return Err(Trouble::NoBootDisk);
    };
    let mut loader_disks: Vec<&str> = parts
        .iter()
        .filter(|p| {
            p.partuuid
                .as_deref()
                .map(str::to_ascii_lowercase)
                .as_deref()
                == Some(loader)
        })
        .filter_map(|p| p.pkname.as_deref())
        .collect();
    loader_disks.sort_unstable();
    loader_disks.dedup();
    match loader_disks.as_slice() {
        [] => return Err(Trouble::NoBootDisk),
        [one] if one == root_disk => {}
        [_] => return Err(Trouble::NoBootDisk),
        _ => return Err(Trouble::TwoSticks),
    }
    let homes: Vec<&Part> = parts
        .iter()
        .filter(|p| p.pkname.as_deref() == Some(root_disk))
        .filter(|p| {
            p.parttype
                .as_deref()
                .map(str::to_ascii_lowercase)
                .as_deref()
                == Some(HOME_TYPE)
        })
        .collect();
    match homes.as_slice() {
        [home] => Ok(home.name.clone()),
        _ => Err(Trouble::NoHome),
    }
}

/// The disks under the device mounted at `/`: one, for a sound stick.
fn root_disks() -> Option<Vec<String>> {
    let mountinfo = std::fs::read_to_string("/proc/self/mountinfo").ok()?;
    // Fields: id parent major:minor root mount-point …; the last mount of / wins.
    let device = mountinfo
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split(' ').collect();
            (f.get(4) == Some(&"/")).then(|| f.get(2).map(|d| (*d).to_owned()))?
        })
        .next_back()?;
    let dm = std::fs::read_link(format!("/sys/dev/block/{device}")).ok()?;
    let dm = dm.file_name()?.to_str()?.to_owned();
    let mut disks: Vec<String> = std::fs::read_dir(format!("/sys/class/block/{dm}/slaves"))
        .ok()?
        .filter_map(|e| disk_of(&e.ok()?.file_name().to_string_lossy()))
        .collect();
    disks.sort_unstable();
    disks.dedup();
    Some(disks)
}

/// The whole disk a partition belongs to (`sda2` → `sda`).
fn disk_of(partition: &str) -> Option<String> {
    let path = std::fs::canonicalize(format!("/sys/class/block/{partition}")).ok()?;
    Some(path.parent()?.file_name()?.to_str()?.to_owned())
}

/// systemd-boot's partition, lower-case. The variable is four attribute bytes and
/// then UTF-16LE text.
fn loader_partuuid() -> Option<String> {
    // efivarfs can't seek, so read it whole.
    let bytes = std::fs::read(LOADER_VAR).ok()?;
    let units: Vec<u16> = bytes
        .get(4..)?
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&c| u16::from_le_bytes(c))
        .take_while(|&u| u != 0)
        .collect();
    Some(String::from_utf16(&units).ok()?.to_ascii_lowercase())
}

fn partitions() -> Option<Vec<Part>> {
    let out = Command::new("lsblk")
        .args(["--json", "--list", "-o", "NAME,PKNAME,PARTUUID,PARTTYPE"])
        .output()
        .ok()?;
    out.status.success().then_some(())?;
    Some(
        serde_json::from_slice::<Lsblk>(&out.stdout)
            .ok()?
            .blockdevices,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const ESP: &str = "c12a7328-f81f-11d2-ba4b-00a0c93ec93b";
    const LOADER: &str = "1f6c2a3e-0000-4000-8000-00000000e5b1";

    fn part(name: &str, disk: &str, uuid: &str, kind: &str) -> Part {
        Part {
            name: name.into(),
            pkname: Some(disk.into()),
            partuuid: Some(uuid.into()),
            parttype: Some(kind.into()),
        }
    }

    fn stick(disk: &str, loader: &str) -> Vec<Part> {
        vec![
            Part {
                name: disk.into(),
                pkname: None,
                partuuid: None,
                parttype: None,
            },
            part(&format!("{disk}1"), disk, loader, ESP),
            part(
                &format!("{disk}4"),
                disk,
                &format!("{disk}-home"),
                HOME_TYPE,
            ),
        ]
    }

    fn roots(d: &str) -> Vec<String> {
        vec![d.to_owned()]
    }

    #[test]
    fn finds_home_on_the_disk_it_started_from() {
        assert_eq!(
            decide(&roots("sda"), LOADER, &stick("sda", LOADER)),
            Ok("sda4".into())
        );
        // Upper-case UUIDs from lsblk still match.
        let mut upper = stick("sda", &LOADER.to_ascii_uppercase());
        upper[2].parttype = Some(HOME_TYPE.to_ascii_uppercase());
        assert_eq!(decide(&roots("sda"), LOADER, &upper), Ok("sda4".into()));
    }

    #[test]
    fn ignores_a_look_alike_home_on_another_disk() {
        let mut parts = stick("sda", LOADER);
        parts.push(part("nvme0n1p3", "nvme0n1", "decoy", HOME_TYPE));
        parts.extend(stick("sdb", "other-build-esp"));
        assert_eq!(decide(&roots("sda"), LOADER, &parts), Ok("sda4".into()));
    }

    #[test]
    fn refuses_two_sticks_of_one_build() {
        let mut parts = stick("sda", LOADER);
        parts.extend(stick("sdb", LOADER));
        assert_eq!(
            decide(&roots("sdb"), LOADER, &parts),
            Err(Trouble::TwoSticks)
        );
        assert_eq!(
            decide(&roots("sda"), LOADER, &parts),
            Err(Trouble::TwoSticks)
        );
    }

    #[test]
    fn refuses_when_the_sources_disagree() {
        // The root came from a disk the firmware didn't start.
        let mut parts = stick("sda", LOADER);
        parts.extend(stick("sdb", "other"));
        assert_eq!(
            decide(&roots("sdb"), LOADER, &parts),
            Err(Trouble::NoBootDisk)
        );
        // The root spans disks, or has none.
        let two = vec!["sda".to_owned(), "sdb".to_owned()];
        assert_eq!(decide(&two, LOADER, &parts), Err(Trouble::NoBootDisk));
        assert_eq!(decide(&[], LOADER, &parts), Err(Trouble::NoBootDisk));
        // The loader's partition is nowhere.
        assert_eq!(
            decide(&roots("sda"), "missing", &parts),
            Err(Trouble::NoBootDisk)
        );
    }

    #[test]
    fn refuses_no_home_or_two() {
        let mut parts = stick("sda", LOADER);
        parts.retain(|p| p.name != "sda4");
        assert_eq!(decide(&roots("sda"), LOADER, &parts), Err(Trouble::NoHome));
        let mut parts = stick("sda", LOADER);
        parts.push(part("sda5", "sda", "second", HOME_TYPE));
        assert_eq!(decide(&roots("sda"), LOADER, &parts), Err(Trouble::NoHome));
    }

    #[test]
    fn reads_lsblk_json() {
        let json = r#"{"blockdevices":[
            {"name":"sda","pkname":null,"partuuid":null,"parttype":null},
            {"name":"sda4","pkname":"sda","partuuid":"abc","parttype":"933ac7e1-2eb4-4f13-b844-0e14e2aef915"}]}"#;
        let parsed: Lsblk = serde_json::from_str(json).expect("lsblk output parses");
        assert_eq!(parsed.blockdevices.len(), 2);
        assert_eq!(parsed.blockdevices[1].pkname.as_deref(), Some("sda"));
    }
}
