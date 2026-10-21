//! What bismillah hands to other apps (ADR-0003): a link from the document, opened with
//! an explicit Ctrl+click or *Open link*, goes to the writer's default browser or mail
//! app, and a folder Settings names goes to their file manager. The address comes from
//! the document, so Rust decides what may leave the app: web and email addresses only,
//! never a file, a script or another app's scheme. bismillah itself requests nothing.

use serde::Serialize;
use url::Url;

/// The longest address handed on; anything longer isn't a link someone wrote.
const MAX_LEN: usize = 8 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LinkError {
    /// Not a web or email address: a file, a script, another app's scheme.
    #[error("not a web or email address")]
    NotWeb,
    /// The folder isn't there (no library open, a disk that isn't connected).
    #[error("the folder isn't available")]
    Unavailable,
    /// No app on this computer opens it.
    #[error("no app opens it")]
    NoApp,
    /// On the bismillah stick, where bismillah is the only app.
    #[error("nothing else runs on the stick")]
    Stick,
}

/// The address as it is handed to the system: `https:`, `http:` or `mailto:`, parsed
/// and written out in ASCII. A `www.` address gets `https://` and a bare email address
/// `mailto:`, as GFM's autolinks read them.
pub fn web_address(raw: &str) -> Result<String, LinkError> {
    let text = raw.trim();
    let text = text
        .strip_prefix('<')
        .and_then(|t| t.strip_suffix('>'))
        .unwrap_or(text)
        .trim();
    if text.is_empty() || text.len() > MAX_LEN || text.chars().any(char::is_control) {
        return Err(LinkError::NotWeb);
    }
    let candidate = if text
        .get(..4)
        .is_some_and(|p| p.eq_ignore_ascii_case("www."))
    {
        format!("https://{text}")
    } else if !text.contains(':') && is_email(text) {
        format!("mailto:{text}")
    } else {
        text.to_owned()
    };
    let url = Url::parse(&candidate).map_err(|_| LinkError::NotWeb)?;
    match url.scheme() {
        "http" | "https" if url.host_str().is_some_and(|h| !h.is_empty()) => Ok(url.into()),
        "mailto" if is_email(url.path()) => Ok(url.into()),
        _ => Err(LinkError::NotWeb),
    }
}

/// The `file://` URI of a folder, for the file manager.
pub fn folder_uri(path: &std::path::Path) -> Option<String> {
    Url::from_directory_path(path).ok().map(String::from)
}

/// `name@example.org`: one `@`, something before it, a dotted domain after it.
fn is_email(text: &str) -> bool {
    let Some((local, domain)) = text.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !text.contains(['/', ' ', '<', '>'])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hands_on_web_and_email_addresses() {
        for (raw, handed) in [
            ("https://example.org/", "https://example.org/"),
            ("http://example.org/a?b=c#d", "http://example.org/a?b=c#d"),
            ("HTTPS://Example.org", "https://example.org/"),
            ("  <https://example.org/x>  ", "https://example.org/x"),
            ("www.example.org/page", "https://www.example.org/page"),
            ("mailto:writer@example.org", "mailto:writer@example.org"),
            (
                "mailto:writer@example.org?subject=Salam",
                "mailto:writer@example.org?subject=Salam",
            ),
            ("writer@example.org", "mailto:writer@example.org"),
            ("<writer@example.org>", "mailto:writer@example.org"),
        ] {
            assert_eq!(web_address(raw).as_deref(), Ok(handed), "{raw}");
        }
    }

    #[test]
    fn names_a_folder_for_the_file_manager() {
        assert_eq!(
            folder_uri(std::path::Path::new("/home/writer/My notes/كتابة")).as_deref(),
            Some("file:///home/writer/My%20notes/%D9%83%D8%AA%D8%A7%D8%A8%D8%A9/")
        );
        assert_eq!(folder_uri(std::path::Path::new("relative/path")), None);
    }

    #[test]
    fn writes_arabic_and_spaces_out_in_ascii() {
        assert_eq!(
            web_address("https://ar.wikipedia.org/wiki/بسملة").as_deref(),
            Ok("https://ar.wikipedia.org/wiki/%D8%A8%D8%B3%D9%85%D9%84%D8%A9")
        );
        assert_eq!(
            web_address("<https://example.org/my notes.pdf>").as_deref(),
            Ok("https://example.org/my%20notes.pdf")
        );
        assert_eq!(
            web_address("https://مثال.example/").as_deref(),
            Ok("https://xn--mgbh0fb.example/")
        );
    }

    #[test]
    fn refuses_everything_that_isnt_the_web_or_email() {
        for raw in [
            "",
            "   ",
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///etc/passwd",
            "/etc/passwd",
            "chapter-2.md",
            "../outside.md",
            "#heading",
            "ftp://example.org/file",
            "steam://run/1",
            "vbscript:msgbox",
            "mailto:",
            "mailto:nobody",
            "https://",
            "https://exa\nmple.org",
            "https://example.org/\u{0}",
            "tel:+46700000000",
            "bismillah-image://localhost/1/a.png",
            "ipc://localhost/doc_save",
        ] {
            assert_eq!(
                web_address(raw),
                Err(LinkError::NotWeb),
                "{raw:?} must be refused"
            );
        }
        let long = format!("https://example.org/{}", "a".repeat(MAX_LEN));
        assert_eq!(web_address(&long), Err(LinkError::NotWeb));
    }
}
