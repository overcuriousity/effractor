//! What every `Storage` promises, written once and run against each
//! implementation — a later one (Postgres, S3) adds a line at the bottom.

use std::future::Future;

use axum::body::Bytes;
use effractor_server::share::{
    FsStorage, MemoryStorage, ShareId, ShareMeta, Storage, StorageError,
};

fn meta(expires_at: Option<u64>, size: usize) -> ShareMeta {
    ShareMeta {
        expires_at,
        delete_token_hash: "ab".repeat(32),
        size: size as u64,
    }
}

async fn contract<S: Storage, F: Future<Output = S>>(make: impl Fn() -> F) {
    // What goes in comes out, bytes and metadata.
    let s = make().await;
    let id = ShareId::random();
    let blob = Bytes::from_static(b"\x00ciphertext\xff");
    s.put(&id, blob.clone(), meta(Some(100), blob.len()))
        .await
        .unwrap();
    assert_eq!(
        s.get(&id).await.unwrap(),
        Some((blob.clone(), meta(Some(100), blob.len())))
    );

    // Unknown is `None`, not an error.
    assert_eq!(s.get(&ShareId::random()).await.unwrap(), None);

    // A share is immutable: the same id cannot be written twice.
    let again = s
        .put(&id, Bytes::from_static(b"other"), meta(None, 5))
        .await;
    assert!(matches!(again, Err(StorageError::Exists)), "{again:?}");
    assert_eq!(s.get(&id).await.unwrap().unwrap().0, blob);

    // Delete says whether there was something to delete.
    assert!(s.delete(&id).await.unwrap());
    assert!(!s.delete(&id).await.unwrap());
    assert_eq!(s.get(&id).await.unwrap(), None);

    // Storage keeps what it is given until told otherwise: expiry is `sweep`,
    // and `sweep` takes what has expired at `now`, and nothing else.
    let s = make().await;
    let (past, edge, future, never) = (
        ShareId::random(),
        ShareId::random(),
        ShareId::random(),
        ShareId::random(),
    );
    for (id, expires) in [
        (&past, Some(50)),
        (&edge, Some(100)),
        (&future, Some(101)),
        (&never, None),
    ] {
        s.put(id, Bytes::from_static(b"x"), meta(expires, 1))
            .await
            .unwrap();
    }
    assert!(s.get(&past).await.unwrap().is_some());
    assert_eq!(s.sweep(100).await.unwrap(), 2);
    assert_eq!(s.get(&past).await.unwrap(), None);
    assert_eq!(s.get(&edge).await.unwrap(), None);
    assert!(s.get(&future).await.unwrap().is_some());
    assert!(s.get(&never).await.unwrap().is_some());
    assert_eq!(s.sweep(100).await.unwrap(), 0);

    // An empty store sweeps to nothing.
    assert_eq!(make().await.sweep(u64::MAX).await.unwrap(), 0);
}

#[tokio::test]
async fn memory_keeps_the_contract() {
    contract(|| async { MemoryStorage::default() }).await;
}

#[tokio::test]
async fn filesystem_keeps_the_contract() {
    let root = tempfile::tempdir().unwrap();
    let n = std::sync::atomic::AtomicUsize::new(0);
    contract(|| {
        let dir = root.path().join(
            n.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                .to_string(),
        );
        async move { FsStorage::new(dir) }
    })
    .await;
}

#[tokio::test]
async fn the_filesystem_layout_is_the_documented_one() {
    let root = tempfile::tempdir().unwrap();
    let s = FsStorage::new(root.path().join("data"));
    // Nothing is created until there is something to keep.
    assert!(!root.path().join("data").exists());

    let id = ShareId::random();
    s.put(&id, Bytes::from_static(b"blob"), meta(Some(7), 4))
        .await
        .unwrap();
    let dir = root.path().join("data").join(&id.as_str()[..2]);
    assert_eq!(
        std::fs::read(dir.join(format!("{id}.bin"))).unwrap(),
        b"blob"
    );
    let written: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.join(format!("{id}.meta.json"))).unwrap())
            .unwrap();
    assert_eq!(
        written,
        serde_json::json!({"expires_at": 7, "delete_token_hash": "ab".repeat(32), "size": 4})
    );
    // Written under another name and renamed: no partial file, nothing left over.
    let names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names.len(), 2, "{names:?}");

    // Another process — a restart — sees the same store.
    let reopened = FsStorage::new(root.path().join("data"));
    assert_eq!(
        reopened.get(&id).await.unwrap().unwrap().0,
        Bytes::from_static(b"blob")
    );
}

#[tokio::test]
async fn a_blob_without_its_metadata_is_not_a_share() {
    // The metadata is written last and removed first: it is the commit. A crash
    // between the two renames leaves a blob that `get` does not see and `sweep`
    // clears away — once it is old — along with abandoned temporary files.
    let root = tempfile::tempdir().unwrap();
    let s = FsStorage::new(root.path().to_owned());
    let id = ShareId::random();
    let dir = root.path().join(&id.as_str()[..2]);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(format!("{id}.bin")), b"orphan").unwrap();
    std::fs::write(dir.join(format!("{id}.bin.tmp")), b"half").unwrap();
    std::fs::write(dir.join("README"), b"someone's note").unwrap();

    assert_eq!(s.get(&id).await.unwrap(), None);
    assert!(!s.delete(&id).await.unwrap());

    // Fresh, it may be a `put` between its two renames: it is left alone.
    s.sweep(0).await.unwrap();
    assert!(dir.join(format!("{id}.bin")).exists());
    assert!(dir.join(format!("{id}.bin.tmp")).exists());

    // An hour old, it is what a crash left behind.
    let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
    for name in [
        format!("{id}.bin"),
        format!("{id}.bin.tmp"),
        "README".into(),
    ] {
        let file = std::fs::File::options()
            .write(true)
            .open(dir.join(name))
            .unwrap();
        file.set_modified(old).unwrap();
    }
    assert_eq!(s.sweep(0).await.unwrap(), 0);
    assert!(!dir.join(format!("{id}.bin")).exists());
    assert!(!dir.join(format!("{id}.bin.tmp")).exists());
    // Not ours, not touched.
    assert!(dir.join("README").exists());
}

#[test]
fn an_id_is_22_url_safe_characters_and_nothing_else_is_an_id() {
    let id = ShareId::random();
    assert_eq!(id.as_str().len(), 22);
    assert!(
        id.as_str()
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    );
    assert_ne!(id, ShareId::random());
    assert_eq!(id.as_str().parse::<ShareId>().unwrap(), id);
    for bad in [
        "",
        "short",
        "../../../../etc/passwd....",
        "aaaaaaaaaaaaaaaaaaaaa/",
        "aaaaaaaaaaaaaaaaaaaaaaa",
        "aaaaaaaaaaaaaaaaaaaaa.",
    ] {
        assert!(bad.parse::<ShareId>().is_err(), "{bad}");
    }
}
