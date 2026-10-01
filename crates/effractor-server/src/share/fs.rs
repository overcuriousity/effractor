use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use async_trait::async_trait;
use axum::body::Bytes;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use super::{ShareId, ShareMeta, Storage, StorageError, Timestamp};

/// `{root}/{id[..2]}/{id}.bin` and `{id}.meta.json` beside it.
///
/// Both are written under a temporary name and renamed, so a reader never sees
/// half a file. The metadata is written last and removed first: it is the
/// commit, and a blob without it is not a share. What a crash can leave behind
/// — a blob with no metadata, a temporary file — `sweep` removes once it is old
/// enough not to be a `put` that is still in progress.
pub struct FsStorage {
    root: PathBuf,
    /// The bytes of the blobs whose metadata is there: counted once when
    /// opened, then kept up to date by `put` and `delete` (and so `sweep`).
    used: AtomicU64,
}

/// A `put` takes milliseconds; anything unfinished for this long is debris.
const DEBRIS_AGE: Duration = Duration::from_secs(600);

impl FsStorage {
    /// Nothing is created until there is something to keep. What is kept
    /// already is counted, once, here: call it at startup.
    pub fn new(root: PathBuf) -> Self {
        let used = AtomicU64::new(kept_bytes(&root));
        Self { root, used }
    }

    fn dir(&self, id: &ShareId) -> PathBuf {
        self.root.join(&id.as_str()[..2])
    }

    fn blob_path(&self, id: &ShareId) -> PathBuf {
        self.dir(id).join(format!("{id}.bin"))
    }

    fn meta_path(&self, id: &ShareId) -> PathBuf {
        self.dir(id).join(format!("{id}.meta.json"))
    }
}

async fn write_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let mut file = fs::File::create(&tmp).await?;
    file.write_all(bytes).await?;
    // On disk before it has its name, or the name could outlive a power cut
    // that the contents did not.
    file.sync_all().await?;
    drop(file);
    fs::rename(&tmp, path).await
}

/// The bytes of the shares under `root`: each blob whose metadata is there.
/// What cannot be read counts as nothing.
fn kept_bytes(root: &Path) -> u64 {
    let Ok(dirs) = std::fs::read_dir(root) else {
        return 0;
    };
    dirs.flatten()
        .filter(|d| d.file_name().to_str().is_some_and(is_prefix))
        .filter_map(|d| std::fs::read_dir(d.path()).ok())
        .flat_map(|files| files.flatten())
        .filter_map(|f| {
            let name = f.file_name();
            let id = name.to_str()?.strip_suffix(".meta.json")?;
            let blob = f.path().with_file_name(format!("{id}.bin"));
            Some(std::fs::metadata(blob).ok()?.len())
        })
        .sum()
}

/// `Ok(None)` if there is no such file.
async fn read(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    match fs::read(path).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Whether there was a file to remove.
async fn remove(path: &Path) -> std::io::Result<bool> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

async fn is_debris(path: &Path) -> bool {
    let modified = fs::metadata(path).await.and_then(|m| m.modified());
    modified.is_ok_and(|at| {
        SystemTime::now()
            .duration_since(at)
            .is_ok_and(|age| age > DEBRIS_AGE)
    })
}

#[async_trait]
impl Storage for FsStorage {
    async fn put(&self, id: &ShareId, blob: Bytes, meta: ShareMeta) -> Result<(), StorageError> {
        fs::create_dir_all(self.dir(id)).await?;
        if fs::try_exists(self.meta_path(id)).await? {
            return Err(StorageError::Exists);
        }
        write_atomically(&self.blob_path(id), &blob).await?;
        write_atomically(&self.meta_path(id), &serde_json::to_vec(&meta)?).await?;
        self.used.fetch_add(blob.len() as u64, Ordering::Relaxed);
        Ok(())
    }

    async fn get(&self, id: &ShareId) -> Result<Option<(Bytes, ShareMeta)>, StorageError> {
        let Some(meta) = self.meta(id).await? else {
            return Ok(None);
        };
        // Gone between the two reads: deleted, which is an answer, not an error.
        Ok(read(&self.blob_path(id))
            .await?
            .map(|blob| (Bytes::from(blob), meta)))
    }

    async fn meta(&self, id: &ShareId) -> Result<Option<ShareMeta>, StorageError> {
        match read(&self.meta_path(id)).await? {
            Some(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
            None => Ok(None),
        }
    }

    async fn delete(&self, id: &ShareId) -> Result<bool, StorageError> {
        // Measured before the metadata goes: only one delete finds it there.
        let size = fs::metadata(self.blob_path(id))
            .await
            .map_or(0, |m| m.len());
        let existed = remove(&self.meta_path(id)).await?;
        if existed {
            let _ = self
                .used
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |u| {
                    Some(u.saturating_sub(size))
                });
            remove(&self.blob_path(id)).await?;
        }
        Ok(existed)
    }

    /// What cannot be read is logged and passed over: one bad directory — a
    /// root-owned `lost+found`, say — must not keep every expired share on
    /// disk. Only directories named like an id prefix are looked into.
    async fn sweep(&self, now: Timestamp) -> Result<u64, StorageError> {
        let mut swept = 0;
        let mut dirs = match fs::read_dir(&self.root).await {
            Ok(dirs) => dirs,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(e.into()),
        };
        loop {
            let dir = match dirs.next_entry().await {
                Ok(Some(dir)) => dir,
                Ok(None) => break,
                Err(err) => {
                    tracing::warn!(%err, "sweep could not list the data directory");
                    break;
                }
            };
            let name = dir.file_name();
            let Some(prefix) = name.to_str().filter(|n| is_prefix(n)) else {
                continue;
            };
            if !dir.file_type().await.is_ok_and(|t| t.is_dir()) {
                continue;
            }
            let (n, failed) = self.sweep_dir(&dir.path(), now).await;
            swept += n;
            if let Some(err) = failed {
                tracing::warn!(%err, dir = prefix, "sweep skipped what it could not read");
            }
        }
        Ok(swept)
    }

    fn used(&self) -> u64 {
        self.used.load(Ordering::Relaxed)
    }
}

/// Two characters of an id: the name of a directory `put` creates.
fn is_prefix(name: &str) -> bool {
    name.len() == 2 && name.bytes().all(|b| super::ALPHABET.contains(&b))
}

impl FsStorage {
    /// How many shares went, and the first error, if an entry failed and was
    /// passed over.
    async fn sweep_dir(&self, dir: &Path, now: Timestamp) -> (u64, Option<StorageError>) {
        let mut swept = 0;
        let mut first_error = None;
        let mut files = match fs::read_dir(dir).await {
            Ok(files) => files,
            Err(err) => return (0, Some(err.into())),
        };
        loop {
            let file = match files.next_entry().await {
                Ok(Some(file)) => file,
                Ok(None) => break,
                Err(err) => {
                    first_error.get_or_insert(err.into());
                    break;
                }
            };
            match self.sweep_file(&file.path(), now).await {
                Ok(true) => swept += 1,
                Ok(false) => {}
                Err(err) => {
                    first_error.get_or_insert(err);
                }
            }
        }
        (swept, first_error)
    }

    /// Whether this was an expired share, now removed.
    async fn sweep_file(&self, path: &Path, now: Timestamp) -> Result<bool, StorageError> {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            return Ok(false);
        };
        let share = |suffix| {
            name.strip_suffix(suffix)
                .and_then(|s: &str| s.parse::<ShareId>().ok())
        };
        if let Some(id) = share(".meta.json") {
            // Unreadable metadata is left for a person to look at.
            let expired = read(path).await?.and_then(|bytes| {
                serde_json::from_slice::<ShareMeta>(&bytes)
                    .ok()
                    .map(|m| m.expired(now))
            });
            return Ok(expired == Some(true) && self.delete(&id).await?);
        }
        // A blob without its metadata, or a temporary file.
        let orphan = match share(".bin") {
            Some(id) => !fs::try_exists(self.meta_path(&id)).await?,
            None => name.ends_with(".bin.tmp") || name.ends_with(".meta.json.tmp"),
        };
        if orphan && is_debris(path).await {
            remove(path).await?;
        }
        Ok(false)
    }
}
