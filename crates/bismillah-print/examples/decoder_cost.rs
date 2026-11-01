//! What a long print costs a reader: `cargo run --release -p bismillah-print --example
//! decoder_cost`. The `ur` decoder copies as it reassembles (mobile/PLAN.md, M3).

#![allow(clippy::unwrap_used, clippy::indexing_slicing, clippy::print_stdout)]

use std::time::{Duration, Instant};

use bismillah_print::{DENSITIES, Printer, Receiver, Step};

fn main() {
    for (density, fragments) in [
        (0, 500),
        (0, 2_000),
        (0, 8_000),
        (3, 2_000),
        (3, 8_000),
        (3, 32_000),
        (3, 65_536),
    ] {
        let density = DENSITIES[density];
        let message = vec![7u8; fragments * density.fragment_bytes];
        let mut printer = Printer::new(&message, density).unwrap();
        let mut receiver = Receiver::default();
        let (mut slowest, mut total, start) = (Duration::ZERO, 0usize, Instant::now());
        loop {
            let part = printer.next_text().unwrap();
            let frame = Instant::now();
            let step = receiver.receive(&part);
            slowest = slowest.max(frame.elapsed());
            total += 1;
            if !matches!(step, Ok(Step::Receiving { .. } | Step::Ignored)) {
                break;
            }
            if start.elapsed() > Duration::from_secs(120) {
                println!(
                    "{fragments} at {} bytes: gave up after 120 s, {total} frames",
                    density.fragment_bytes
                );
                break;
            }
        }
        println!(
            "K={fragments} fragment={} frames={total} total={:.2}s slowest={:.1}ms",
            density.fragment_bytes,
            start.elapsed().as_secs_f64(),
            slowest.as_secs_f64() * 1000.0
        );
    }
}
