//! A fresh phone key and its check words, for writing a test: `phone_key`.

#![allow(clippy::print_stdout)]

fn main() {
    let key = bismillah_print::PhoneSecret::generate();
    println!("{}\n{}", key.public().text(), key.public().check_words());
}
