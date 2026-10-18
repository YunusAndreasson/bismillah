//! Binary-size probe: Hunspell only.
fn main() {
    let h = hunspell_rs::Hunspell::new("../../dictionaries/ar/ar.aff", "../../dictionaries/ar/ar.dic");
    let w = std::env::args().nth(1).unwrap_or_default();
    println!("{:?} {:?}", h.check(&w), h.suggest(&w));
}
