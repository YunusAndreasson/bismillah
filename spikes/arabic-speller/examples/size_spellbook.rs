//! Binary-size probe: spellbook only.
fn main() {
    let aff = std::fs::read_to_string("../../dictionaries/ar/ar.aff").unwrap();
    let dic = std::fs::read_to_string("../../dictionaries/ar/ar.dic").unwrap();
    let d = spellbook::Dictionary::new(&aff, &dic).unwrap();
    let w = std::env::args().nth(1).unwrap_or_default();
    let mut s = Vec::new();
    d.suggest(&w, &mut s);
    println!("{} {:?}", d.check(&w), s);
}
