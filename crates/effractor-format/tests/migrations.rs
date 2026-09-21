//! Every file under `fixtures/migrations/v<N>/` is a document as version N
//! wrote it. Loading migrates it; saving must give the file of the same name
//! under `fixtures/canonical/`. A new schema version adds a directory here and
//! a step to the chain — and never edits an old directory.

use std::fs;
use std::path::Path;

use effractor_format::{CURRENT_VERSION, canonicalize};

#[test]
fn old_documents_arrive_at_the_current_canonical_form() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let mut seen = 0;
    for version in 1..=CURRENT_VERSION {
        let dir = root.join(format!("migrations/v{version}"));
        let files = fs::read_dir(&dir).unwrap_or_else(|_| panic!("no fixtures for v{version}"));
        for entry in files {
            let path = entry.unwrap().path();
            let want = root.join("canonical").join(path.file_name().unwrap());
            let got = canonicalize(&fs::read_to_string(&path).unwrap())
                .unwrap_or_else(|d| panic!("{}: {d:?}", path.display()));
            assert_eq!(
                got,
                fs::read_to_string(&want).unwrap(),
                "{}",
                path.display()
            );
            seen += 1;
        }
    }
    assert!(seen > 0);
}
