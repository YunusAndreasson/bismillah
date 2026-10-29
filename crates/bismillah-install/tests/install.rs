//! The installer on small made-up images and sticks (files): a GPT with an ESP holding
//! the stick-id placeholder, a root and verity of filler bytes, and an empty home, the
//! way os/tests/stick.test.ts makes them for stick.ts. The VM scenario `published`
//! (os/scripts/test.ts) does the same with the real image and boots it.

// The helpers that make the images and sticks are test setup too.
#![allow(clippy::unwrap_used)]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use bismillah_install::bundle::{Bundle, hex};
use bismillah_install::disk::Disk;
use bismillah_install::gpt::{ESP, Guid, HOME, Layout, ROOT, ROOT_VERITY, SECTOR, Table};
use bismillah_install::stickid::{self, Id, Identity};
use bismillah_install::{Error, Journal, Kind, inspect, install, update};
use flate2::Compression;
use flate2::write::GzEncoder;
use sha2::{Digest, Sha256};

const MIB: u64 = 1024 * 1024;
/// Where each image's stick-id placeholder sits inside its ESP.
const ID_AT: u64 = 64 * 1024;

/// A scratch folder, removed when the test is done with it.
struct Tmp(PathBuf);

impl std::ops::Deref for Tmp {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.0
    }
}

impl Drop for Tmp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn dir(name: &str) -> Tmp {
    let d = std::env::temp_dir().join(format!(
        "bismillah-install-{}-{name}-{}",
        std::process::id(),
        Guid::random().unwrap()
    ));
    fs::create_dir_all(&d).unwrap();
    Tmp(d)
}

fn put(buf: &mut [u8], at: u64, data: &[u8]) {
    buf[at as usize..at as usize + data.len()].copy_from_slice(data);
}

fn header(
    disk: Guid,
    my: u64,
    alt: u64,
    entries_lba: u64,
    last_usable: u64,
    entries: &[u8],
) -> Vec<u8> {
    let mut h = vec![0u8; SECTOR as usize];
    h[0..8].copy_from_slice(b"EFI PART");
    h[8..12].copy_from_slice(&0x0001_0000u32.to_le_bytes());
    h[12..16].copy_from_slice(&92u32.to_le_bytes());
    h[24..32].copy_from_slice(&my.to_le_bytes());
    h[32..40].copy_from_slice(&alt.to_le_bytes());
    h[40..48].copy_from_slice(&34u64.to_le_bytes());
    h[48..56].copy_from_slice(&last_usable.to_le_bytes());
    h[56..72].copy_from_slice(&disk.bytes());
    h[72..80].copy_from_slice(&entries_lba.to_le_bytes());
    h[80..84].copy_from_slice(&128u32.to_le_bytes());
    h[84..88].copy_from_slice(&128u32.to_le_bytes());
    h[88..92].copy_from_slice(&crc32fast::hash(entries).to_le_bytes());
    let crc = crc32fast::hash(&h[..92]);
    h[16..20].copy_from_slice(&crc.to_le_bytes());
    h
}

/// An image of the stick's shape: sizes in MiB of the ESP, root, verity and home, and
/// the byte root and verity are filled with. Root and verity GUIDs follow the fill, as
/// the real ones follow the root hash.
struct Build {
    root_mib: u64,
    fill: u8,
    extra: bool,
}

const ROOT_GUIDS: [&str; 3] = [
    "aaaaaaaa-0000-4000-8000-000000000001",
    "aaaaaaaa-0000-4000-8000-000000000002",
    "aaaaaaaa-0000-4000-8000-000000000003",
];

fn image(b: &Build) -> Vec<u8> {
    let parts: Vec<(&str, u64, Guid)> = vec![
        (
            ESP,
            MIB,
            Guid::parse("eeeeeeee-0000-4000-8000-000000000000").unwrap(),
        ),
        (
            ROOT,
            b.root_mib * MIB,
            Guid::parse(ROOT_GUIDS[b.fill as usize % 3]).unwrap(),
        ),
        (
            ROOT_VERITY,
            MIB / 4,
            Guid::parse(&format!(
                "bbbbbbbb-0000-4000-8000-00000000000{}",
                b.fill % 10
            ))
            .unwrap(),
        ),
        (
            HOME,
            MIB,
            Guid::parse("cccccccc-0000-4000-8000-000000000000").unwrap(),
        ),
    ];
    let mut parts = parts;
    if b.extra {
        parts.push((
            "0fc63daf-8483-4772-8e79-3d69d8477de4",
            MIB / 4,
            Guid::random().unwrap(),
        ));
    }
    let mut entries = vec![0u8; 128 * 128];
    let mut lba = 2048u64;
    let mut places = Vec::new();
    for (i, (kind, bytes, uuid)) in parts.iter().enumerate() {
        let e = &mut entries[i * 128..(i + 1) * 128];
        e[0..16].copy_from_slice(&Guid::parse(kind).unwrap().bytes());
        e[16..32].copy_from_slice(&uuid.bytes());
        let last = lba + bytes / SECTOR - 1;
        e[32..40].copy_from_slice(&lba.to_le_bytes());
        e[40..48].copy_from_slice(&last.to_le_bytes());
        places.push((*kind, lba * SECTOR, *bytes));
        lba = last + 1;
    }
    let last = lba + 33 - 1 + 1; // 33 sectors for the backup, after one spare
    let mut img = vec![0u8; ((last + 1) * SECTOR) as usize];
    // The protective MBR, as mkosi writes it: one 0xEE entry over the image.
    img[446 + 4] = 0xee;
    put(&mut img, 446 + 8, &1u32.to_le_bytes());
    put(&mut img, 446 + 12, &(last as u32).to_le_bytes());
    img[510] = 0x55;
    img[511] = 0xaa;
    let disk = Guid::parse("dddddddd-0000-4000-8000-000000000000").unwrap();
    put(
        &mut img,
        SECTOR,
        &header(disk, 1, last, 2, last - 33, &entries),
    );
    put(&mut img, 2 * SECTOR, &entries);
    put(&mut img, (last - 32) * SECTOR, &entries);
    put(
        &mut img,
        last * SECTOR,
        &header(disk, last, 1, last - 32, last - 33, &entries),
    );
    for (kind, offset, bytes) in places {
        if kind == ROOT || kind == ROOT_VERITY {
            img[offset as usize..(offset + bytes) as usize].fill(b.fill);
        }
        if kind == ESP {
            img[offset as usize..(offset + bytes) as usize].fill(0xe5);
            let mut placeholder = b"bismillah stick id 1\nunflashed\n".to_vec();
            placeholder.resize(511, b'#');
            placeholder.push(b'\n');
            put(&mut img, offset + ID_AT, &placeholder);
        }
    }
    img
}

/// The image published as os/scripts/publish.ts does: gzip, in parts, and a manifest.
fn publish(b: &Build, part: usize) -> Tmp {
    let img = image(b);
    let out = dir("bundle");
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    gz.write_all(&img).unwrap();
    let gz = gz.finish().unwrap();
    let mut manifest = format!(
        "bismillah-stick 1\nversion test-{}\nraw-size {}\nraw-sha256 {}\nstickid-offset {}\n",
        b.fill,
        img.len(),
        hex(&Sha256::digest(&img)),
        2048 * SECTOR + ID_AT
    );
    for (i, piece) in gz.chunks(part).enumerate() {
        let name = format!("image-{i:03}.gz");
        fs::write(out.join(&name), piece).unwrap();
        manifest += &format!(
            "part {name} {} {}\n",
            piece.len(),
            hex(&Sha256::digest(piece))
        );
    }
    fs::write(out.join("manifest"), manifest).unwrap();
    out
}

fn stick(at: &Path, mib: u64, fill: u8) -> String {
    let path = at.join("stick.raw");
    fs::write(&path, vec![fill; (mib * MIB) as usize]).unwrap();
    path.to_string_lossy().into_owned()
}

fn quiet() -> impl FnMut(&str) {
    |_| {}
}

fn table(path: &str) -> (Table, Layout) {
    let mut d = Disk::file(path, false).unwrap();
    let t = Table::read(path, &mut |o, l| d.read_at(o, l)).unwrap();
    let l = Layout::of(path, &t).unwrap();
    (t, l)
}

fn stick_id(path: &str, layout: &Layout) -> Option<Id> {
    let bytes = fs::read(path).unwrap();
    let at = (layout.esp.offset() + ID_AT) as usize;
    stickid::parse(&bytes[at..at + stickid::BYTES])
}

fn installed(bundle: &Path, path: &str) -> Identity {
    let b = Bundle::open(bundle).unwrap();
    install(&b, &mut Disk::file(path, true).unwrap(), &mut quiet()).unwrap()
}

const A: Build = Build {
    root_mib: 2,
    fill: 1,
    extra: false,
};
const B: Build = Build {
    root_mib: 2,
    fill: 2,
    extra: false,
};

#[test]
fn a_first_flash_gives_the_stick_its_own_identity_and_a_backup_gpt_at_its_end() {
    let bundle = publish(&A, 100_000);
    let at = dir("first");
    let path = stick(&at, 16, 0xab);
    let id = installed(&bundle, &path);

    let (t, l) = table(&path);
    assert_eq!(t.disk, id.disk);
    assert_eq!(l.esp.uuid, id.esp);
    assert_eq!(l.home.unwrap().uuid, id.home);
    assert_eq!(l.root.uuid.to_string(), ROOT_GUIDS[1]);
    assert_eq!(stick_id(&path, &l), Some(Id::Flashed(id)));

    // The backup GPT is at the stick's last sector, and names the primary.
    let bytes = fs::read(&path).unwrap();
    let last = bytes.len() as u64 / SECTOR - 1;
    assert_eq!(t.alternate, last);
    assert_eq!(t.last_usable, last - 33);
    let backup = &bytes[(last * SECTOR) as usize..];
    assert_eq!(&backup[0..8], b"EFI PART");
    assert_eq!(u64::from_le_bytes(backup[24..32].try_into().unwrap()), last);
    assert_eq!(u64::from_le_bytes(backup[32..40].try_into().unwrap()), 1);
    assert_eq!(
        u64::from_le_bytes(backup[72..80].try_into().unwrap()),
        last - 32
    );
    let mut zeroed = backup[..92].to_vec();
    zeroed[16..20].fill(0);
    assert_eq!(crc32fast::hash(&zeroed).to_le_bytes(), backup[16..20]);
    let entries = &bytes[((last - 32) * SECTOR) as usize..(last * SECTOR) as usize];
    assert_eq!(crc32fast::hash(entries).to_le_bytes(), backup[88..92]);

    // The protective MBR covers the whole stick.
    assert_eq!(bytes[446 + 4], 0xee);
    assert_eq!(
        u32::from_le_bytes(bytes[458..462].try_into().unwrap()),
        last as u32
    );

    // The image's own backup is gone from the middle of the stick, and home is empty.
    let img = image(&A);
    let old = img.len() - SECTOR as usize;
    assert!(bytes[old - 32 * 512..old + 512].iter().all(|&b| b == 0));
    let home = l.home.unwrap();
    assert!(
        bytes[home.offset() as usize..(home.offset() + home.bytes()) as usize]
            .iter()
            .all(|&b| b == 0)
    );
    assert!(
        bytes[l.root.offset() as usize..(l.root.offset() + l.root.bytes()) as usize]
            .iter()
            .all(|&b| b == 1)
    );

    assert!(
        matches!(inspect(&mut Disk::file(&path, false).unwrap()), Kind::Bismillah(i) if i == id)
    );
    // Two sticks from one image are never twins.
    let second = dir("second");
    let path2 = stick(&second, 16, 0);
    let other = installed(&bundle, &path2);
    assert!(other.disk != id.disk && other.esp != id.esp && other.home != id.home);
}

#[test]
fn a_damaged_download_or_a_small_stick_writes_nothing() {
    let bundle = publish(&A, 1_000);
    let at = dir("damaged");
    let path = stick(&at, 16, 0xab);
    let before = fs::read(&path).unwrap();

    let mut part = fs::read(bundle.join("image-001.gz")).unwrap();
    part[100] ^= 1;
    fs::write(bundle.join("image-001.gz"), &part).unwrap();
    let b = Bundle::open(&bundle).unwrap();
    let r = install(&b, &mut Disk::file(&path, true).unwrap(), &mut quiet());
    assert!(
        matches!(r, Err(Error::Refused(ref why)) if why.contains("image-001.gz")),
        "{r:?}"
    );
    assert_eq!(fs::read(&path).unwrap(), before);

    fs::remove_file(bundle.join("image-001.gz")).unwrap();
    let r = install(&b, &mut Disk::file(&path, true).unwrap(), &mut quiet());
    assert!(matches!(r, Err(Error::Refused(_))), "{r:?}");

    let good = publish(&A, 1_000);
    let small_dir = dir("small");
    let small = stick(&small_dir, 4, 0xab);
    let before = fs::read(&small).unwrap();
    let b = Bundle::open(&good).unwrap();
    let r = install(&b, &mut Disk::file(&small, true).unwrap(), &mut quiet());
    assert!(
        matches!(r, Err(Error::Refused(ref why)) if why.contains("too small")),
        "{r:?}"
    );
    assert_eq!(fs::read(&small).unwrap(), before);

    // An image with another partition isn't the stick's.
    let odd = publish(&Build { extra: true, ..A }, 1_000);
    let b = Bundle::open(&odd).unwrap();
    let r = install(&b, &mut Disk::file(&small, true).unwrap(), &mut quiet());
    assert!(
        matches!(r, Err(Error::Refused(ref why)) if why.contains("another type")),
        "{r:?}"
    );
}

#[test]
fn an_update_rewrites_the_system_and_keeps_home() {
    let at = dir("update");
    let path = stick(&at, 16, 0);
    let id = installed(&publish(&A, 100_000), &path);
    let (_, l) = table(&path);
    let home = l.home.unwrap();
    // The writer's texts, as setup and saving leave them.
    let mut bytes = fs::read(&path).unwrap();
    for (i, b) in bytes[home.offset() as usize..(home.offset() + home.bytes()) as usize]
        .iter_mut()
        .enumerate()
    {
        *b = (i * 7 % 251) as u8;
    }
    fs::write(&path, &bytes).unwrap();
    let texts = bytes[home.offset() as usize..(home.offset() + home.bytes()) as usize].to_vec();

    let journal = dir("journal");
    let published = publish(&B, 100_000);
    let b = Bundle::open(&published).unwrap();
    update(
        &b,
        &mut Disk::file(&path, true).unwrap(),
        &Journal::new(&journal),
        &mut quiet(),
    )
    .unwrap();

    let (t, l) = table(&path);
    assert_eq!(
        (t.disk, l.esp.uuid, l.home.unwrap().uuid),
        (id.disk, id.esp, id.home)
    );
    assert_eq!(l.root.uuid.to_string(), ROOT_GUIDS[2]);
    assert_eq!(
        l.verity.uuid.to_string(),
        "bbbbbbbb-0000-4000-8000-000000000002"
    );
    assert_eq!(stick_id(&path, &l), Some(Id::Flashed(id)));
    let after = fs::read(&path).unwrap();
    assert!(
        after[l.root.offset() as usize..(l.root.offset() + l.root.bytes()) as usize]
            .iter()
            .all(|&b| b == 2)
    );
    assert_eq!(
        after[home.offset() as usize..(home.offset() + home.bytes()) as usize],
        texts[..]
    );
    // The backup GPT took the new GUIDs too.
    let last = after.len() as u64 / SECTOR - 1;
    let entries = &after[((last - 32) * SECTOR) as usize..(last * SECTOR) as usize];
    assert_eq!(
        &entries[16 + 128..32 + 128],
        &Guid::parse(ROOT_GUIDS[2]).unwrap().bytes()
    );
    assert_eq!(fs::read_dir(&*journal).unwrap().count(), 0);
}

#[test]
fn an_update_refuses_a_stick_that_does_not_vouch_for_itself() {
    let at = dir("vouch");
    let path = stick(&at, 16, 0);
    let id = installed(&publish(&A, 100_000), &path);
    let (_, l) = table(&path);
    let id_at = (l.esp.offset() + ID_AT) as usize;
    let journal = dir("journal");
    let published = publish(&B, 100_000);
    let b = Bundle::open(&published).unwrap();
    let run = |path: &str| {
        update(
            &b,
            &mut Disk::file(path, true).unwrap(),
            &Journal::new(&journal),
            &mut quiet(),
        )
    };

    // A stick-id naming another stick.
    let mut bytes = fs::read(&path).unwrap();
    let stranger = Identity {
        disk: Guid::random().unwrap(),
        ..id
    };
    put(&mut bytes, id_at as u64, &stickid::file(&stranger));
    fs::write(&path, &bytes).unwrap();
    assert!(matches!(run(&path), Err(Error::Refused(ref why)) if why.contains("other GUIDs")));
    assert_eq!(fs::read(&path).unwrap(), bytes);

    // No stick-id, as an update cut off in the ESP leaves it: only with the journal.
    bytes[id_at..id_at + 512].fill(0);
    fs::write(&path, &bytes).unwrap();
    assert!(matches!(run(&path), Err(Error::Refused(ref why)) if why.contains("no stick-id")));
    assert_eq!(fs::read(&path).unwrap(), bytes);
    fs::write(
        journal.join(format!("{}.updating", id.disk)),
        format!("esp {}\nhome {}\n", id.esp, id.home),
    )
    .unwrap();
    run(&path).unwrap();
    let (_, l) = table(&path);
    assert_eq!(stick_id(&path, &l), Some(Id::Flashed(id)));

    // A new root bigger than the stick's slot.
    let bigger = publish(&Build { root_mib: 3, ..B }, 100_000);
    let big = Bundle::open(&bigger).unwrap();
    let before = fs::read(&path).unwrap();
    let r = update(
        &big,
        &mut Disk::file(&path, true).unwrap(),
        &Journal::new(&journal),
        &mut quiet(),
    );
    assert!(
        matches!(r, Err(Error::Refused(ref why)) if why.contains("bigger than the stick's slot")),
        "{r:?}"
    );
    assert_eq!(fs::read(&path).unwrap(), before);

    // Not a bismillah stick at all.
    let blank_dir = dir("blank");
    let blank = stick(&blank_dir, 16, 0);
    assert!(matches!(
        inspect(&mut Disk::file(&blank, false).unwrap()),
        Kind::Other
    ));
    assert!(matches!(run(&blank), Err(Error::Refused(_))));
}
