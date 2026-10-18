//! Baseline for binary-size comparison.
fn main() {
    let w = std::env::args().nth(1).unwrap_or_default();
    println!("{}", w.len());
}
