//! Local images for live preview (ADR-0012, ARCHITECTURE.md §6).
//!
//! The frontend asks for an image by the open document's id and the destination exactly
//! as the Markdown gives it (`![…](figures/map.png)`). Rust resolves it against the
//! document's folder, canonicalises it and serves it only if it is an image file inside
//! the library: `..`, absolute paths, `file:` URLs and symlinks all go through the same
//! check as every other path. Anything else gets an empty "not found", so a document
//! can't use an image to learn what lies outside the folder the writer chose.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::library::Library;

/// Larger files aren't shown (a photograph straight from a camera is well under this).
const MAX_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum ImageError {
    /// The address isn't a local path (a web address, `javascript:`, malformed).
    NotLocal,
    NotFound,
    Outside,
    NotAnImage,
    TooLarge,
}

/// Decodes `%XX` escapes as UTF-8; `None` if they don't make valid UTF-8.
pub fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let escaped = (bytes[i] == b'%')
            .then(|| bytes.get(i + 1..i + 3))
            .flatten()
            .and_then(|hex| std::str::from_utf8(hex).ok())
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match escaped {
            Some(byte) => {
                out.push(byte);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// The file a Markdown image destination names, before any check.
fn local_path(document: &Path, src: &str) -> Result<PathBuf, ImageError> {
    let src = src.trim();
    let src = src
        .strip_prefix('<')
        .and_then(|s| s.strip_suffix('>'))
        .unwrap_or(src);
    if src.is_empty() || src.contains('\0') {
        return Err(ImageError::NotLocal);
    }
    let path = if let Some(rest) = src.strip_prefix("file://") {
        let rest = rest.strip_prefix("localhost").unwrap_or(rest);
        if !rest.starts_with('/') {
            return Err(ImageError::NotLocal);
        }
        PathBuf::from(percent_decode(rest).ok_or(ImageError::NotLocal)?)
    } else {
        // Any other scheme (https:, data:, javascript:) isn't a file.
        let scheme = src.split_once(':').map(|(s, _)| s);
        if scheme.is_some_and(|s| {
            s.len() > 1
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
        }) {
            return Err(ImageError::NotLocal);
        }
        let decoded = PathBuf::from(percent_decode(src).ok_or(ImageError::NotLocal)?);
        if decoded.is_absolute() {
            decoded
        } else {
            document.parent().ok_or(ImageError::NotFound)?.join(decoded)
        }
    };
    Ok(path)
}

/// The image's content type, by its ending; `None` for anything that isn't an image.
pub fn content_type(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Resolves and checks an image destination written in `document`.
pub fn resolve(library: &Library, document: &Path, src: &str) -> Result<PathBuf, ImageError> {
    let path = local_path(document, src)?;
    let real = fs::canonicalize(&path).map_err(|_| ImageError::NotFound)?;
    if !library.contains(&real) {
        return Err(ImageError::Outside);
    }
    if content_type(&real).is_none() || !real.is_file() {
        return Err(ImageError::NotAnImage);
    }
    Ok(real)
}

/// Reads a checked image, with its content type.
pub fn read(path: &Path) -> Result<(Vec<u8>, &'static str), ImageError> {
    let kind = content_type(path).ok_or(ImageError::NotAnImage)?;
    let file = fs::File::open(path).map_err(|_| ImageError::NotFound)?;
    if file.metadata().map_err(|_| ImageError::NotFound)?.len() > MAX_BYTES {
        return Err(ImageError::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ImageError::NotFound)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(ImageError::TooLarge);
    }
    Ok((bytes, kind))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::testing::Scratch;

    fn setup() -> (Scratch, Library, PathBuf) {
        let scratch = Scratch::new();
        let root = scratch.path().join("library");
        fs::create_dir_all(root.join("essays/figures")).unwrap();
        fs::write(root.join("essays/figures/map.png"), b"png").unwrap();
        fs::write(root.join("essays/My Map.JPG"), b"jpg").unwrap();
        fs::write(root.join("essays/notes.txt"), b"text").unwrap();
        fs::write(root.join("cover.svg"), b"<svg/>").unwrap();
        fs::write(scratch.path().join("secret.png"), b"secret").unwrap();
        let library = Library::open(&root).unwrap();
        let doc = library.root().join("essays/letter.md");
        (scratch, library, doc)
    }

    #[test]
    fn resolves_paths_relative_to_the_document() {
        let (_s, library, doc) = setup();
        let root = library.root().to_path_buf();
        assert_eq!(
            resolve(&library, &doc, "figures/map.png"),
            Ok(root.join("essays/figures/map.png"))
        );
        assert_eq!(
            resolve(&library, &doc, "./figures/map.png"),
            Ok(root.join("essays/figures/map.png"))
        );
        assert_eq!(
            resolve(&library, &doc, "../cover.svg"),
            Ok(root.join("cover.svg"))
        );
        assert_eq!(
            resolve(&library, &doc, "My%20Map.JPG"),
            Ok(root.join("essays/My Map.JPG"))
        );
        assert_eq!(
            resolve(&library, &doc, "<My Map.JPG>"),
            Ok(root.join("essays/My Map.JPG"))
        );
        let absolute = root.join("cover.svg");
        assert_eq!(
            resolve(&library, &doc, absolute.to_str().unwrap()),
            Ok(absolute.clone())
        );
        let url = format!("file://{}", absolute.to_str().unwrap());
        assert_eq!(resolve(&library, &doc, &url), Ok(absolute));
    }

    #[test]
    fn refuses_anything_outside_the_library() {
        let (scratch, library, doc) = setup();
        assert_eq!(
            resolve(&library, &doc, "../../secret.png"),
            Err(ImageError::Outside)
        );
        let outside = scratch.path().join("secret.png");
        assert_eq!(
            resolve(&library, &doc, outside.to_str().unwrap()),
            Err(ImageError::Outside)
        );
        let url = format!("file://{}", outside.to_str().unwrap());
        assert_eq!(resolve(&library, &doc, &url), Err(ImageError::Outside));
        // A link inside the library that points out of it.
        std::os::unix::fs::symlink(&outside, library.root().join("essays/link.png")).unwrap();
        assert_eq!(
            resolve(&library, &doc, "link.png"),
            Err(ImageError::Outside)
        );
    }

    #[test]
    fn refuses_web_addresses_scripts_and_other_files() {
        let (_s, library, doc) = setup();
        for src in [
            "https://example.com/a.png",
            "//example.com/a.png",
            "data:image/png;base64,AAAA",
            "javascript:alert(1)",
            "",
            "a\0.png",
        ] {
            assert!(resolve(&library, &doc, src).is_err(), "{src}");
        }
        assert_eq!(
            resolve(&library, &doc, "notes.txt"),
            Err(ImageError::NotAnImage)
        );
        assert_eq!(
            resolve(&library, &doc, "figures"),
            Err(ImageError::NotAnImage)
        );
        assert_eq!(
            resolve(&library, &doc, "missing.png"),
            Err(ImageError::NotFound)
        );
    }

    #[test]
    fn reads_an_image_with_its_type() {
        let (_s, library, doc) = setup();
        let path = resolve(&library, &doc, "figures/map.png").unwrap();
        assert_eq!(read(&path), Ok((b"png".to_vec(), "image/png")));
    }

    #[test]
    fn decodes_percent_escapes_as_utf8() {
        assert_eq!(percent_decode("a%20b%C3%A9").as_deref(), Some("a bé"));
        assert_eq!(percent_decode("100%").as_deref(), Some("100%"));
        assert_eq!(percent_decode("%ZZ").as_deref(), Some("%ZZ"));
        assert_eq!(percent_decode("%FF"), None);
    }
}
