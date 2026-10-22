//! Damaged request lines for testing the helper's parser (os/PLAN.md, OS-5): the unit
//! tests feed them to the parser, and the debug image's `bismillah-probe fuzz` sends
//! them to the running helper. Deterministic, so a failure can be replayed by its seed.
//! Never in the release helper.

/// Lines the mutations start from. None of them changes anything, and none is within
/// four mutations of a request that would: `power` has no action, and every verb that
/// acts is more than four letters away from `status` and `shell`.
pub const SEEDS: [&str; 6] = [
    r#"{"v":1,"verb":"status"}"#,
    r#"{"v":2,"verb":"status"}"#,
    r#"{"verb":"status"}"#,
    r#"{"v":1,"verb":"shell","command":"/bin/sh"}"#,
    r#"{"v":1,"verb":"power"}"#,
    r#"{"v":1,"verb":"status","passphrase":"x"}"#,
];

/// A small xorshift generator: no dependency, and the same lines for the same seed.
pub struct Lines {
    state: u64,
}

impl Lines {
    pub fn new(seed: u64) -> Self {
        Lines {
            state: seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1,
        }
    }

    fn next(&mut self) -> u64 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 7;
        self.state ^= self.state << 17;
        self.state
    }

    fn below(&mut self, n: usize) -> usize {
        usize::try_from(self.next() % (n.max(1) as u64)).unwrap_or(0)
    }

    /// The next damaged line, without its newline: one to four mutations of a seed, or
    /// noise, or a line longer than the helper reads.
    pub fn line(&mut self) -> Vec<u8> {
        let mut line = SEEDS[self.below(SEEDS.len())].as_bytes().to_vec();
        for _ in 0..=self.below(4) {
            let at = self.below(line.len() + 1);
            match self.below(8) {
                0 => {
                    if let Some(b) = line.get_mut(at) {
                        *b ^= 1 << self.below(8);
                    }
                }
                1 => line.insert(at, (self.next() & 0xff) as u8),
                2 if at < line.len() => {
                    line.remove(at);
                }
                3 => line.truncate(at),
                4 => {
                    let chunk = line[at..].to_vec();
                    line.splice(at..at, chunk);
                }
                5 => {
                    let quote = br#"\u0000""#;
                    line.splice(at..at, quote.iter().copied());
                }
                6 => {
                    let n = 1 + self.below(64);
                    line = (0..n).map(|_| (self.next() & 0xff) as u8).collect();
                }
                _ => {
                    // Past the longest line the helper reads.
                    line.extend(std::iter::repeat_n(b'{', 17 * 1024));
                }
            }
        }
        // A newline inside the line would end it early; keep each line one line.
        line.retain(|&b| b != b'\n');
        line
    }
}
