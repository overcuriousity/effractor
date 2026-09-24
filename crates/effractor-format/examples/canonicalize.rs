//! Rewrites files in canonical form: `cargo run -p effractor-format --example canonicalize -- FILE…`.
fn main() {
    for path in std::env::args().skip(1) {
        let text = std::fs::read_to_string(&path).expect("readable");
        match effractor_format::canonicalize(&text) {
            Ok(out) => std::fs::write(&path, out).expect("writable"),
            Err(d) => panic!("{path}: {d:?}"),
        }
    }
}
