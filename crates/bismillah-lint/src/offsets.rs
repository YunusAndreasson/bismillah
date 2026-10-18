//! The one place text offsets change units (ADR-0004, ARCHITECTURE.md §7.1).
//!
//! The editor counts UTF-16 code units, Harper counts Unicode scalar values (`char`s) and
//! Rust slices strings by bytes. Every conversion between them goes through [`Offsets`],
//! so an emoji, a combining mark or an Arabic diacritic can never shift a diagnostic
//! onto the wrong letters.

/// Offsets of every `char` boundary in one block of text, in UTF-16 code units and bytes.
pub struct Offsets {
    /// `utf16[i]`: code units before char `i`; one more entry than there are chars.
    utf16: Vec<u32>,
    /// `bytes[i]`: bytes before char `i`; one more entry than there are chars.
    bytes: Vec<u32>,
}

impl Offsets {
    pub fn new(text: &str) -> Self {
        let count = text.chars().count();
        let mut utf16 = Vec::with_capacity(count + 1);
        let mut bytes = Vec::with_capacity(count + 1);
        let (mut u, mut b) = (0u32, 0u32);
        for c in text.chars() {
            utf16.push(u);
            bytes.push(b);
            u += c.len_utf16() as u32;
            b += c.len_utf8() as u32;
        }
        utf16.push(u);
        bytes.push(b);
        Offsets { utf16, bytes }
    }

    /// The number of chars in the text.
    pub fn chars(&self) -> usize {
        self.utf16.len() - 1
    }

    /// The text's length in UTF-16 code units.
    pub fn utf16_len(&self) -> u32 {
        self.utf16[self.chars()]
    }

    /// The UTF-16 offset of char `index`, clamped to the end of the text.
    pub fn char_to_utf16(&self, index: usize) -> u32 {
        self.utf16[index.min(self.chars())]
    }

    /// The byte offset of char `index`, clamped to the end of the text.
    pub fn char_to_byte(&self, index: usize) -> usize {
        self.bytes[index.min(self.chars())] as usize
    }

    /// The char at UTF-16 offset `offset`, clamped to the end of the text. An offset in
    /// the middle of a surrogate pair belongs to that pair's char.
    pub fn utf16_to_char(&self, offset: u32) -> usize {
        match self.utf16.binary_search(&offset) {
            Ok(index) => index,
            Err(index) => index.saturating_sub(1).min(self.chars()),
        }
    }

    /// A UTF-16 range as a char range, clamped to the text and never reversed.
    pub fn utf16_range_to_chars(&self, from: u32, to: u32) -> (usize, usize) {
        let start = self.utf16_to_char(from.min(to));
        // An end inside a surrogate pair takes the whole pair.
        let end = match self.utf16.binary_search(&from.max(to)) {
            Ok(index) => index,
            Err(index) => index.min(self.chars()),
        };
        (start, end.max(start))
    }
}

#[cfg(test)]
mod tests {
    use super::Offsets;

    #[test]
    fn ascii_counts_the_same_in_every_unit() {
        let o = Offsets::new("recieve");
        assert_eq!(o.chars(), 7);
        assert_eq!(o.utf16_len(), 7);
        assert_eq!(o.char_to_utf16(3), 3);
        assert_eq!(o.utf16_to_char(3), 3);
        assert_eq!(o.char_to_byte(3), 3);
    }

    #[test]
    fn an_emoji_is_one_char_two_code_units_and_four_bytes() {
        // "a 😀 recieve": the misspelling starts at char 4, UTF-16 unit 5, byte 7.
        let text = "a 😀 recieve";
        let o = Offsets::new(text);
        assert_eq!(o.chars(), 11);
        assert_eq!(o.utf16_len(), 12);
        assert_eq!(o.char_to_utf16(4), 5);
        assert_eq!(o.utf16_to_char(5), 4);
        assert_eq!(o.char_to_byte(4), 7);
        assert_eq!(&text[o.char_to_byte(4)..], "recieve");
        // Inside the surrogate pair: the start rounds down, the end takes the pair.
        assert_eq!(o.utf16_to_char(3), 2);
        assert_eq!(o.utf16_range_to_chars(2, 3), (2, 3));
    }

    #[test]
    fn combining_marks_are_chars_of_their_own() {
        // "café" with a combining acute (U+0301): five chars, five code units, six bytes.
        let text = "cafe\u{301} recieve";
        let o = Offsets::new(text);
        assert_eq!(o.char_to_utf16(6), 6);
        assert_eq!(o.char_to_byte(6), 7);
        assert_eq!(&text[o.char_to_byte(6)..], "recieve");
    }

    #[test]
    fn arabic_diacritics_keep_their_place() {
        // كَتَبَ: three letters, each with a fatha: six chars, six code units, twelve bytes.
        let text = "كَتَبَ كتابب";
        let o = Offsets::new(text);
        assert_eq!(o.chars(), 12);
        assert_eq!(o.utf16_len(), 12);
        assert_eq!(o.char_to_utf16(7), 7);
        assert_eq!(o.char_to_byte(7), 13);
        assert_eq!(&text[o.char_to_byte(7)..], "كتابب");
    }

    #[test]
    fn crlf_is_two_chars() {
        let text = "one\r\ntwo recieve";
        let o = Offsets::new(text);
        assert_eq!(o.char_to_utf16(9), 9);
        assert_eq!(&text[o.char_to_byte(9)..], "recieve");
        assert_eq!(o.utf16_range_to_chars(3, 5), (3, 5));
    }

    #[test]
    fn out_of_range_offsets_clamp_to_the_end() {
        let o = Offsets::new("ab");
        assert_eq!(o.utf16_to_char(99), 2);
        assert_eq!(o.char_to_utf16(99), 2);
        assert_eq!(o.char_to_byte(99), 2);
        assert_eq!(o.utf16_range_to_chars(5, 1), (1, 2));
    }
}
