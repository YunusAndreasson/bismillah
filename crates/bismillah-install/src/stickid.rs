//! The ESP's `bismillah/stick-id`: 512 bytes naming the stick's disk, ESP and home
//! GUIDs, in the format os/scripts/stick.ts writes and reads.

use crate::gpt::Guid;

/// The first line of every stick-id, and its fixed length.
pub const HEAD: &[u8] = b"bismillah stick id 1\n";
pub const BYTES: usize = 512;

/// Which stick this is: its GPT's disk GUID and its ESP's and home's partition GUIDs.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Identity {
    pub disk: Guid,
    pub esp: Guid,
    pub home: Guid,
}

/// What a block that starts with the head says.
#[derive(PartialEq, Eq, Debug)]
pub enum Id {
    /// The image's placeholder, before a first flash.
    Unflashed,
    Flashed(Identity),
    /// The head, then something else.
    Damaged,
}

/// The stick-id file: the head, the three GUIDs, padded with '#' to 512 bytes.
pub fn file(id: &Identity) -> Vec<u8> {
    let text = format!(
        "bismillah stick id 1\ndisk {}\nesp {}\nhome {}\n",
        id.disk, id.esp, id.home
    );
    let mut b = text.into_bytes();
    b.resize(BYTES - 1, b'#');
    b.push(b'\n');
    b
}

/// What `block` says, or `None` when it isn't a stick-id at all.
pub fn parse(block: &[u8]) -> Option<Id> {
    let rest = block.strip_prefix(HEAD)?;
    if rest.starts_with(b"unflashed\n") {
        return Some(Id::Unflashed);
    }
    let text = String::from_utf8_lossy(rest);
    let field = |name: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(name)?.strip_prefix(' '))
            .and_then(Guid::parse)
    };
    Some(match (field("disk"), field("esp"), field("home")) {
        (Some(disk), Some(esp), Some(home)) => Id::Flashed(Identity { disk, esp, home }),
        _ => Id::Damaged,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_file_is_what_stick_ts_writes() {
        let id = Identity {
            disk: Guid::parse("11111111-2222-4333-8444-555555555555").unwrap(),
            esp: Guid::parse("66666666-7777-4888-9999-aaaaaaaaaaaa").unwrap(),
            home: Guid::parse("bbbbbbbb-cccc-4ddd-aeee-ffffffffffff").unwrap(),
        };
        let f = file(&id);
        assert_eq!(f.len(), BYTES);
        let text = String::from_utf8(f.clone()).unwrap();
        assert!(text.starts_with(
            "bismillah stick id 1\ndisk 11111111-2222-4333-8444-555555555555\nesp 66666666-7777-4888-9999-aaaaaaaaaaaa\nhome bbbbbbbb-cccc-4ddd-aeee-ffffffffffff\n#"
        ));
        assert!(text.ends_with("##\n"));
        assert_eq!(parse(&f), Some(Id::Flashed(id)));
    }

    #[test]
    fn placeholders_damage_and_strangers() {
        let mut placeholder = b"bismillah stick id 1\nunflashed\n".to_vec();
        placeholder.resize(BYTES, b'#');
        assert_eq!(parse(&placeholder), Some(Id::Unflashed));
        assert_eq!(
            parse(b"bismillah stick id 1\ndisk nonsense\n"),
            Some(Id::Damaged)
        );
        assert_eq!(parse(&[0u8; BYTES]), None);
    }
}
