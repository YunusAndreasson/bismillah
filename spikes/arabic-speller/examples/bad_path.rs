//! Does hunspell-rs report a missing dictionary?
fn main() {
    let h = hunspell_rs::Hunspell::new("/nonexistent/ar.aff", "/nonexistent/ar.dic");
    println!("check(كتاب) = {:?}; suggest = {:?}", h.check("كتاب"), h.suggest("كتابب"));
}
