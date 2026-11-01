//! What a test needs around the real reader: a camera's side of a frame, and the vectors.

use bismillah_print::Frame;

/// Draws a frame as the dialog does: greyscale, `scale` pixels a module, quiet zone.
pub fn draw(frame: &Frame, scale: u32, quiet: u32) -> (Vec<u8>, usize) {
    let side = ((frame.size + 2 * quiet) * scale) as usize;
    let mut image = vec![255u8; side * side];
    let size = frame.size as usize;
    let (scale, quiet) = (scale as usize, quiet as usize);
    for y in 0..size {
        for x in 0..size {
            if frame.dark[y * size + x] {
                for py in 0..scale {
                    for px in 0..scale {
                        image[((y + quiet) * scale + py) * side + (x + quiet) * scale + px] = 0;
                    }
                }
            }
        }
    }
    (image, side)
}

/// Finds and reads the one QR code in a greyscale image.
pub fn read_code(image: Vec<u8>, side: usize) -> String {
    let mut prepared =
        rqrr::PreparedImage::prepare_from_greyscale(side, side, |x, y| image[y * side + x]);
    let grids = prepared.detect_grids();
    assert_eq!(grids.len(), 1);
    grids[0].decode().unwrap().1
}

/// A file in tests/fixtures/print/, one `key: value` a line, then the parts.
pub struct Vector {
    pub name: String,
    pub selection: bool,
    pub density: usize,
    pub bytes: Vec<u8>,
    pub message: Vec<u8>,
    pub parts: Vec<String>,
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
        .collect()
}

impl Vector {
    pub fn parse(text: &str) -> Self {
        let field = |key: &str| {
            text.lines()
                .find_map(|l| l.strip_prefix(key)?.strip_prefix(": "))
                .unwrap()
                .to_owned()
        };
        Self {
            name: field("name"),
            selection: field("selection") == "true",
            density: field("density").parse().unwrap(),
            bytes: unhex(&field("bytes")),
            message: unhex(&field("message")),
            parts: text
                .lines()
                .filter_map(|l| l.strip_prefix("part: "))
                .map(str::to_owned)
                .collect(),
        }
    }
}
