//! Colour themes (ARCHITECTURE.md §8, ADR-0005).
//!
//! A theme is a TOML or JSON file that sets semantic token values (DESIGN.md §9.2) for
//! light and/or dark, and nothing else: no CSS, no selectors, no code. bismillah's own
//! themes (`src-tauri/themes/`) are files in the same format, compiled in. The writer's
//! go in `<config>/bismillah/themes/`. Every file is checked here: known keys only,
//! colours parsed, and the result checked for contrast against DESIGN.md §9.4. A theme
//! with problems is still listed, with them, so Settings can say what is wrong; only one
//! that can't be read, or sets no colour, can't be chosen.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// The tokens a theme may set (DESIGN.md §9.2). `surface-code` is derived (below).
pub const TOKENS: &[&str] = &[
    "surface-editor",
    "surface-panel",
    "text-primary",
    "text-secondary",
    "syntax-marker",
    "accent",
    "selection-background",
    "border-control",
    "diagnostic-spelling",
    "diagnostic-grammar",
    "status-error",
    "focus-ring",
];

/// The tokens that follow another unless a theme sets them (tokens.css aliases them).
const ALIASES: &[(&str, &str)] = &[
    ("status-error", "diagnostic-spelling"),
    ("focus-ring", "accent"),
];

/// bismillah's own colours (src/styles/tokens.css; a test keeps them equal), under any
/// token a theme leaves out.
const LIGHT: &[(&str, &str)] = &[
    ("surface-editor", "#f7f6f2"),
    ("surface-panel", "#eeede8"),
    ("text-primary", "#1e1e1e"),
    ("text-secondary", "#62625e"),
    ("syntax-marker", "#6b6b65"),
    ("accent", "#1e6b4a"),
    ("selection-background", "#d6eadf"),
    ("border-control", "#84847c"),
    ("diagnostic-spelling", "#9f3c36"),
    ("diagnostic-grammar", "#805d12"),
];

const DARK: &[(&str, &str)] = &[
    ("surface-editor", "#151515"),
    ("surface-panel", "#202020"),
    ("text-primary", "#d4d4d2"),
    ("text-secondary", "#a2a29b"),
    ("syntax-marker", "#94948d"),
    ("accent", "#6fbf95"),
    ("selection-background", "#23432f"),
    ("border-control", "#74746e"),
    ("diagnostic-spelling", "#f08b82"),
    ("diagnostic-grammar", "#d5b56a"),
];

/// The themes that come with bismillah, by id. bismillah's own colours ("bismillah")
/// need no file: they are the stylesheet's.
const BUILT_IN: &[(&str, &str)] = &[
    ("sepia", include_str!("../themes/sepia.toml")),
    ("slate", include_str!("../themes/slate.toml")),
];

/// The id of bismillah's own colours, the `colour_theme` default.
pub const DEFAULT_ID: &str = "bismillah";

/// A theme file larger than this isn't read: a real one is about 1 KiB.
const MAX_BYTES: u64 = 64 * 1024;
/// At most this many of the writer's theme files are listed.
const MAX_THEMES: usize = 100;

/// Contrast floors (DESIGN.md §9.4).
const TEXT_MIN: f64 = 4.5;
const NON_TEXT_MIN: f64 = 3.0;

type Rgb = [u8; 3];

/// `#rgb` or `#rrggbb`, opaque: contrast can only be measured on opaque colours.
fn parse_colour(text: &str) -> Option<Rgb> {
    let hex = text.trim().strip_prefix('#')?;
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let digit = |i: usize| u8::from_str_radix(&hex[i..i + 1], 16).ok();
    let pair = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    match hex.len() {
        3 => Some([digit(0)? * 17, digit(1)? * 17, digit(2)? * 17]),
        6 => Some([pair(0)?, pair(2)?, pair(4)?]),
        _ => None,
    }
}

fn hex(rgb: Rgb) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])
}

/// WCAG 2.x relative luminance.
fn luminance(rgb: Rgb) -> f64 {
    let lin = |c: u8| {
        let c = f64::from(c) / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
}

fn contrast(a: Rgb, b: Rgb) -> f64 {
    let (x, y) = (luminance(a), luminance(b));
    (x.max(y) + 0.05) / (x.min(y) + 0.05)
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Variant {
    Light,
    Dark,
}

/// Something wrong with a theme file, for Settings to explain.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Problem {
    /// Not valid TOML or JSON; `line` where the parser stopped, if it said.
    Unreadable {
        line: Option<usize>,
    },
    TooLarge,
    /// A `schema` other than 1: made for another version of bismillah.
    Schema,
    /// A key bismillah doesn't know (`light.surface`), ignored.
    UnknownKey {
        key: String,
    },
    /// `name` isn't text, or `light`/`dark` isn't a table.
    WrongType {
        key: String,
    },
    /// A colour that isn't `#rgb` or `#rrggbb`, ignored.
    InvalidColour {
        key: String,
        value: String,
    },
    /// Neither light nor dark sets a usable colour.
    NoColours,
    /// Another theme (built in, or another file) already has this file's name.
    SameName,
    /// A pair below its contrast floor. The theme still applies: it is the writer's.
    Contrast {
        variant: Variant,
        foreground: String,
        background: String,
        /// Rounded down to one decimal, so it never reads as passing when it doesn't.
        ratio: f64,
        needed: f64,
    },
}

#[derive(Clone, Debug, Serialize)]
pub struct Theme {
    /// The file's name without its ending; what `colour_theme` holds.
    pub id: String,
    /// Its `name`, or its id.
    pub name: String,
    pub builtin: bool,
    /// The file's name in the themes folder; none for a built-in theme.
    pub file: Option<String>,
    /// The tokens it sets for each, as `#rrggbb` (`surface-code` as `#rrggbbaa`).
    pub light: Option<BTreeMap<String, String>>,
    pub dark: Option<BTreeMap<String, String>>,
    pub usable: bool,
    pub problems: Vec<Problem>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Themes {
    pub themes: Vec<Theme>,
    /// More files than `MAX_THEMES` were found; only the first are listed.
    pub truncated: bool,
}

/// A theme file read into a small tree, the same for TOML and JSON.
enum Node {
    Text(String),
    Integer(i64),
    Table(Vec<(String, Node)>),
    Other,
}

fn line_at(text: &str, offset: usize) -> usize {
    text.get(..offset).map_or(0, |s| s.matches('\n').count()) + 1
}

fn from_toml_value(value: &toml_edit::Value) -> Node {
    match value {
        toml_edit::Value::String(s) => Node::Text(s.value().clone()),
        toml_edit::Value::Integer(i) => Node::Integer(*i.value()),
        toml_edit::Value::InlineTable(t) => Node::Table(
            t.iter()
                .map(|(k, v)| (k.to_string(), from_toml_value(v)))
                .collect(),
        ),
        _ => Node::Other,
    }
}

fn from_toml_item(item: &toml_edit::Item) -> Node {
    match item {
        toml_edit::Item::Value(v) => from_toml_value(v),
        toml_edit::Item::Table(t) => Node::Table(
            t.iter()
                .map(|(k, v)| (k.to_string(), from_toml_item(v)))
                .collect(),
        ),
        _ => Node::Other,
    }
}

fn from_json(value: &serde_json::Value) -> Node {
    match value {
        serde_json::Value::String(s) => Node::Text(s.clone()),
        serde_json::Value::Number(n) => n.as_i64().map_or(Node::Other, Node::Integer),
        serde_json::Value::Object(o) => {
            Node::Table(o.iter().map(|(k, v)| (k.clone(), from_json(v))).collect())
        }
        _ => Node::Other,
    }
}

/// Reads a file's text as TOML, or as JSON when `json`.
fn parse(text: &str, json: bool) -> Result<Vec<(String, Node)>, Problem> {
    let root = if json {
        let value: serde_json::Value =
            serde_json::from_str(text).map_err(|e| Problem::Unreadable {
                line: Some(e.line()).filter(|&l| l > 0),
            })?;
        from_json(&value)
    } else {
        let doc = toml_edit::Document::parse(text).map_err(|e| Problem::Unreadable {
            line: e.span().map(|s| line_at(text, s.start)),
        })?;
        from_toml_item(doc.as_item())
    };
    match root {
        Node::Table(entries) => Ok(entries),
        _ => Err(Problem::Unreadable { line: None }),
    }
}

/// The colours of one variant: those the theme sets, in canonical form.
fn variant_tokens(
    prefix: &str,
    entries: Vec<(String, Node)>,
    problems: &mut Vec<Problem>,
) -> BTreeMap<String, Rgb> {
    let mut tokens = BTreeMap::new();
    for (key, value) in entries {
        let path = format!("{prefix}.{key}");
        if !TOKENS.contains(&key.as_str()) {
            problems.push(Problem::UnknownKey { key: path });
            continue;
        }
        let text = match value {
            Node::Text(text) => text,
            _ => String::new(),
        };
        match parse_colour(&text) {
            Some(rgb) => {
                tokens.insert(key, rgb);
            }
            None => problems.push(Problem::InvalidColour {
                key: path,
                value: text,
            }),
        }
    }
    tokens
}

/// The theme's colours over bismillah's own, aliases following their source.
fn merged(variant: Variant, own: &BTreeMap<String, Rgb>) -> BTreeMap<&'static str, Rgb> {
    let base = match variant {
        Variant::Light => LIGHT,
        Variant::Dark => DARK,
    };
    let mut out: BTreeMap<&'static str, Rgb> = TOKENS
        .iter()
        .filter_map(|&token| {
            let given = own.get(token).copied();
            let builtin = base
                .iter()
                .find(|(t, _)| *t == token)
                .and_then(|(_, v)| parse_colour(v));
            Some((token, given.or(builtin)?))
        })
        .collect();
    for (alias, source) in ALIASES {
        if !own.contains_key(*alias)
            && let Some(&rgb) = out.get(source)
        {
            out.insert(alias, rgb);
        }
    }
    out
}

/// The ground of rendered code: `text-primary` at the alpha that draws `surface-panel`
/// on the editor (DESIGN.md §9.2), translucent so a selection behind it shows.
fn code_ground(palette: &BTreeMap<&'static str, Rgb>) -> Option<([u8; 4], Rgb)> {
    let text = palette.get("text-primary")?;
    let editor = palette.get("surface-editor")?;
    let panel = palette.get("surface-panel")?;
    let d = |a: &Rgb, i: usize| f64::from(a[i]) - f64::from(editor[i]);
    let along: f64 = (0..3).map(|i| d(panel, i) * d(text, i)).sum();
    let length: f64 = (0..3).map(|i| d(text, i).powi(2)).sum();
    let alpha = if length > 0.0 { along / length } else { 0.0 };
    let byte = (alpha.clamp(0.02, 0.25) * 255.0).round() as u8;
    let a = f64::from(byte) / 255.0;
    let over = |i: usize| (f64::from(text[i]) * a + f64::from(editor[i]) * (1.0 - a)).round() as u8;
    Some((
        [text[0], text[1], text[2], byte],
        [over(0), over(1), over(2)],
    ))
}

/// Every pair DESIGN.md §9.4 requires, as (foreground, background, floor).
fn pairs() -> Vec<(&'static str, &'static str, f64)> {
    const TEXT: &[&str] = &[
        "text-primary",
        "text-secondary",
        "syntax-marker",
        "accent",
        "diagnostic-spelling",
        "diagnostic-grammar",
        "status-error",
    ];
    let mut out = Vec::new();
    for bg in ["surface-editor", "surface-panel"] {
        out.extend(TEXT.iter().map(|&fg| (fg, bg, TEXT_MIN)));
        out.extend(["border-control", "focus-ring"].map(|fg| (fg, bg, NON_TEXT_MIN)));
    }
    // Selected text is drawn in text-primary (DESIGN.md §9.4).
    out.push(("text-primary", "selection-background", TEXT_MIN));
    for fg in ["text-primary", "text-secondary", "syntax-marker"] {
        out.push((fg, "surface-code", TEXT_MIN));
    }
    out
}

fn contrast_problems(
    variant: Variant,
    palette: &BTreeMap<&'static str, Rgb>,
    ground: Option<Rgb>,
) -> Vec<Problem> {
    pairs()
        .into_iter()
        .filter_map(|(fg, bg, needed)| {
            let a = *palette.get(fg)?;
            let b = if bg == "surface-code" {
                ground?
            } else {
                *palette.get(bg)?
            };
            let ratio = contrast(a, b);
            (ratio < needed).then(|| Problem::Contrast {
                variant,
                foreground: fg.into(),
                background: bg.into(),
                ratio: (ratio * 10.0).floor() / 10.0,
                needed,
            })
        })
        .collect()
}

/// Reads one theme from its text.
fn theme(id: &str, file: Option<String>, text: &str, json: bool) -> Theme {
    let mut problems = Vec::new();
    let mut name = None;
    let mut sets: [Option<BTreeMap<String, Rgb>>; 2] = [None, None];
    match parse(text, json) {
        Err(problem) => problems.push(problem),
        Ok(entries) => {
            for (key, value) in entries {
                match (key.as_str(), value) {
                    ("schema", Node::Integer(1)) => {}
                    ("schema", _) => problems.push(Problem::Schema),
                    ("name", Node::Text(text)) if !text.trim().is_empty() => {
                        name = Some(text.trim().chars().take(64).collect::<String>());
                    }
                    ("light" | "dark", Node::Table(entries)) => {
                        let slot = usize::from(key == "dark");
                        sets[slot] = Some(variant_tokens(&key, entries, &mut problems));
                    }
                    ("name" | "light" | "dark", _) => problems.push(Problem::WrongType { key }),
                    _ => problems.push(Problem::UnknownKey { key }),
                }
            }
        }
    }
    let mut out = [None, None];
    for (slot, variant) in [(0, Variant::Light), (1, Variant::Dark)] {
        let Some(own) = sets[slot].take().filter(|t| !t.is_empty()) else {
            continue;
        };
        let palette = merged(variant, &own);
        let ground = code_ground(&palette);
        problems.extend(contrast_problems(variant, &palette, ground.map(|g| g.1)));
        let mut tokens: BTreeMap<String, String> =
            own.iter().map(|(k, v)| (k.clone(), hex(*v))).collect();
        // The stylesheet's code ground is drawn for its own colours: derive one for these.
        if ["text-primary", "surface-editor", "surface-panel"]
            .iter()
            .any(|t| own.contains_key(*t))
            && let Some((rgba, _)) = ground
        {
            tokens.insert(
                "surface-code".into(),
                format!("{}{:02x}", hex([rgba[0], rgba[1], rgba[2]]), rgba[3]),
            );
        }
        out[slot] = Some(tokens);
    }
    let [light, dark] = out;
    let readable = !problems
        .iter()
        .any(|p| matches!(p, Problem::Unreadable { .. }));
    if readable && light.is_none() && dark.is_none() {
        problems.push(Problem::NoColours);
    }
    Theme {
        id: id.into(),
        name: name.unwrap_or_else(|| id.into()),
        builtin: file.is_none(),
        file,
        usable: light.is_some() || dark.is_some(),
        light,
        dark,
        problems,
    }
}

/// bismillah's themes, then the writer's from `folder` (missing: none), in name order.
pub fn list(folder: &Path) -> Themes {
    let mut themes: Vec<Theme> = BUILT_IN
        .iter()
        .map(|(id, text)| theme(id, None, text, false))
        .collect();
    let mut files: Vec<(String, std::path::PathBuf)> = fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let lower = name.to_lowercase();
            let themed = lower.ends_with(".toml") || lower.ends_with(".json");
            (themed && !name.starts_with('.')).then(|| (name, entry.path()))
        })
        .collect();
    files.sort_by(|a, b| {
        a.0.to_lowercase()
            .cmp(&b.0.to_lowercase())
            .then(a.0.cmp(&b.0))
    });
    let truncated = files.len() > MAX_THEMES;
    files.truncate(MAX_THEMES);
    for (name, path) in files {
        let Some((id, ending)) = name.rsplit_once('.') else {
            continue;
        };
        let json = ending.eq_ignore_ascii_case("json");
        let size = fs::metadata(&path).map(|m| (m.is_file(), m.len()));
        let mut item = match size {
            Ok((true, len)) if len > MAX_BYTES => unreadable(id, &name, Problem::TooLarge),
            Ok((true, _)) => match fs::read_to_string(&path) {
                Ok(text) => theme(id, Some(name.clone()), &text, json),
                Err(_) => unreadable(id, &name, Problem::Unreadable { line: None }),
            },
            // A folder or something else with a theme's ending isn't one.
            _ => continue,
        };
        let taken = id == DEFAULT_ID || themes.iter().any(|t| t.id == id);
        if taken {
            item.usable = false;
            item.problems.insert(0, Problem::SameName);
        }
        themes.push(item);
    }
    Themes { themes, truncated }
}

fn unreadable(id: &str, file: &str, problem: Problem) -> Theme {
    Theme {
        id: id.into(),
        name: id.into(),
        builtin: false,
        file: Some(file.into()),
        light: None,
        dark: None,
        usable: false,
        problems: vec![problem],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Scratch;

    fn read(text: &str) -> Theme {
        theme("test", Some("test.toml".into()), text, false)
    }

    #[test]
    fn parses_short_and_long_colours_and_nothing_else() {
        assert_eq!(parse_colour("#1E6B4A"), Some([0x1e, 0x6b, 0x4a]));
        assert_eq!(parse_colour("#fff"), Some([255, 255, 255]));
        assert_eq!(parse_colour(" #000000 "), Some([0, 0, 0]));
        for bad in [
            "1e6b4a",
            "#12345",
            "#1e6b4a80",
            "#ggg",
            "red",
            "",
            "#+1+1+1",
        ] {
            assert_eq!(parse_colour(bad), None, "{bad}");
        }
    }

    #[test]
    fn keeps_the_colours_the_theme_sets() {
        let t = read(
            "schema = 1\nname = \"Paper\"\n[light]\naccent = \"#1E6B4A\"\n\
             diagnostic-grammar = \"#805D12\"\n",
        );
        assert_eq!(t.name, "Paper");
        assert!(t.usable);
        assert_eq!(t.problems, vec![]);
        let light = t.light.expect("light");
        assert_eq!(light["accent"], "#1e6b4a");
        assert_eq!(
            light.len(),
            2,
            "no code ground without a surface or text colour"
        );
        assert_eq!(t.dark, None);
    }

    #[test]
    fn reads_json_the_same_way() {
        let t = theme(
            "night",
            Some("night.json".into()),
            r##"{"name": "Night", "dark": {"surface-editor": "#000", "text-primary": "#eee"}}"##,
            true,
        );
        assert_eq!(t.name, "Night");
        let dark = t.dark.expect("dark");
        assert_eq!(dark["surface-editor"], "#000000");
        assert!(dark.contains_key("surface-code"));
        assert_eq!(t.light, None);
    }

    #[test]
    fn lists_unknown_keys_and_bad_colours_and_ignores_them() {
        let t = read(
            "colour = 1\nname = 3\n[light]\naccent = \"green\"\nsurface = \"#fff\"\n\
             text-primary = 7\nborder-control = \"#808080\"\n[sepia]\n",
        );
        assert!(t.usable);
        assert_eq!(t.name, "test");
        assert_eq!(
            t.problems,
            vec![
                Problem::UnknownKey {
                    key: "colour".into()
                },
                Problem::WrongType { key: "name".into() },
                Problem::InvalidColour {
                    key: "light.accent".into(),
                    value: "green".into()
                },
                Problem::UnknownKey {
                    key: "light.surface".into()
                },
                Problem::InvalidColour {
                    key: "light.text-primary".into(),
                    value: String::new()
                },
                Problem::UnknownKey {
                    key: "sepia".into()
                },
            ]
        );
        assert_eq!(
            t.light.expect("light").keys().collect::<Vec<_>>(),
            ["border-control"]
        );
    }

    #[test]
    fn says_where_a_file_stops_being_toml_or_json() {
        let t = read("name = \"x\"\n[light]\naccent = \"#fff\n");
        assert_eq!(t.problems, vec![Problem::Unreadable { line: Some(3) }]);
        assert!(!t.usable);
        let j = theme("j", Some("j.json".into()), "{\n\"light\": {\n}\n,", true);
        assert!(matches!(
            j.problems[..],
            [Problem::Unreadable { line: Some(4) }]
        ));
        assert!(!read("schema = 2\n").usable);
        assert_eq!(
            read("schema = 2\n").problems,
            vec![Problem::Schema, Problem::NoColours]
        );
    }

    #[test]
    fn warns_about_low_contrast_but_still_applies_the_theme() {
        let t = read("[dark]\ntext-secondary = \"#555555\"\n");
        assert!(t.usable);
        let contrast: Vec<_> = t
            .problems
            .iter()
            .map(|p| match p {
                Problem::Contrast {
                    variant,
                    foreground,
                    background,
                    ratio,
                    needed,
                } => (
                    *variant,
                    foreground.as_str(),
                    background.as_str(),
                    *ratio,
                    *needed,
                ),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(
            contrast,
            [
                (Variant::Dark, "text-secondary", "surface-editor", 2.4, 4.5),
                (Variant::Dark, "text-secondary", "surface-panel", 2.1, 4.5),
                (Variant::Dark, "text-secondary", "surface-code", 2.1, 4.5),
            ]
        );
    }

    #[test]
    fn checks_the_aliases_through_their_source() {
        // focus-ring follows the accent: a pale accent fails as text and as a ring.
        let t = read("[light]\naccent = \"#d0e0d8\"\n");
        let failing: Vec<_> = t
            .problems
            .iter()
            .filter_map(|p| match p {
                Problem::Contrast { foreground, .. } => Some(foreground.as_str()),
                _ => None,
            })
            .collect();
        assert!(failing.contains(&"accent") && failing.contains(&"focus-ring"));
    }

    #[test]
    fn derives_the_code_ground_as_the_stylesheet_does() {
        // bismillah's own colours give tokens.css's values exactly.
        for (variant, alpha) in [(Variant::Light, 0x0b), (Variant::Dark, 0x0f)] {
            let palette = merged(variant, &BTreeMap::new());
            let (rgba, _) = code_ground(&palette).expect("ground");
            assert_eq!(rgba[3], alpha, "{variant:?}");
        }
    }

    #[test]
    fn built_in_themes_have_no_problems_and_prose_above_seven() {
        for (id, text) in BUILT_IN {
            let t = theme(id, None, text, false);
            assert_eq!(t.problems, vec![], "{id}");
            for (variant, tokens) in [(Variant::Light, &t.light), (Variant::Dark, &t.dark)] {
                let tokens = tokens.as_ref().expect("both variants");
                let own = tokens
                    .iter()
                    .filter_map(|(k, v)| Some((k.clone(), parse_colour(v)?)))
                    .collect();
                let palette = merged(variant, &own);
                let prose = contrast(palette["text-primary"], palette["surface-editor"]);
                assert!(prose > 7.0, "{id} {variant:?}: {prose}");
            }
        }
    }

    /// The `--name: value` declarations of the first block after `selector`.
    fn css_block<'a>(css: &'a str, selector: &str) -> BTreeMap<&'a str, &'a str> {
        let at = css.find(selector).expect("selector");
        let open = at + css[at..].find('{').expect("{") + 1;
        let close = open + css[open..].find('}').expect("}");
        css[open..close]
            .split(';')
            .filter_map(|d| {
                // A declaration may follow a comment.
                let d = d.rsplit("*/").next().unwrap_or(d);
                let (name, value) = d.trim().split_once(':')?;
                Some((name.trim().strip_prefix("--")?, value.trim()))
            })
            .collect()
    }

    #[test]
    fn keeps_bismillahs_own_colours_equal_to_the_stylesheet() {
        let css = include_str!("../../src/styles/tokens.css");
        let primitives = css_block(css, ":root {");
        for (selector, table) in [
            (":root[data-theme=\"light\"]", LIGHT),
            ("\n:root[data-theme=\"dark\"]", DARK),
        ] {
            let block = css_block(css, selector);
            for (token, value) in table {
                let declared = block[token];
                let resolved = declared
                    .strip_prefix("var(--")
                    .and_then(|v| v.strip_suffix(')'))
                    .map_or(declared, |name| primitives[name]);
                assert_eq!(resolved.to_lowercase(), *value, "{selector} {token}");
            }
        }
    }

    #[test]
    fn lists_built_in_themes_then_the_writers_files() {
        let scratch = Scratch::new();
        scratch.file("b-night.json", br##"{"dark": {"accent": "#6fbf95"}}"##);
        scratch.file("A-paper.TOML", b"[light]\naccent = \"#1e6b4a\"\n");
        scratch.file(".hidden.toml", b"[light]\naccent = \"#1e6b4a\"\n");
        scratch.file("notes.txt", b"not a theme");
        scratch.file("sepia.toml", b"[light]\naccent = \"#1e6b4a\"\n");
        scratch.file("bismillah.toml", b"[light]\naccent = \"#1e6b4a\"\n");
        scratch.file("empty.toml", b"name = \"Nothing\"\n");
        fs::create_dir(scratch.path().join("folder.toml")).unwrap();
        let big = vec![b' '; MAX_BYTES as usize + 1];
        scratch.file("huge.toml", &big);
        let list = list(scratch.path());
        let summary: Vec<_> = list
            .themes
            .iter()
            .map(|t| (t.id.as_str(), t.builtin, t.usable))
            .collect();
        assert_eq!(
            summary,
            [
                ("sepia", true, true),
                ("slate", true, true),
                ("A-paper", false, true),
                ("b-night", false, true),
                ("bismillah", false, false),
                ("empty", false, false),
                ("huge", false, false),
                ("sepia", false, false),
            ]
        );
        let by_file = |f: &str| {
            list.themes
                .iter()
                .find(|t| t.file.as_deref() == Some(f))
                .expect(f)
        };
        assert_eq!(by_file("sepia.toml").problems, vec![Problem::SameName]);
        assert_eq!(by_file("empty.toml").problems, vec![Problem::NoColours]);
        assert_eq!(by_file("empty.toml").name, "Nothing");
        assert_eq!(by_file("huge.toml").problems, vec![Problem::TooLarge]);
        assert!(!list.truncated);
    }

    #[test]
    fn lists_nothing_of_the_writers_without_a_folder() {
        let scratch = Scratch::new();
        let list = list(&scratch.path().join("themes"));
        assert!(list.themes.iter().all(|t| t.builtin));
    }
}
