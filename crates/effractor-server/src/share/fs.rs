use std::io::ErrorKind;
use std::path::{Path, PathBuf};
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
}

/// A `put` takes milliseconds; anything unfinished for this long is debris.
const DEBRIS_AGE: Duration = Duration::from_secs(600);

impl FsStorage {
    /// Nothing is created until there is something to keep.
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn dir(&self, id: &ShareId) -> PathBuf {
        self.root.join(&id.as_str()[..2])
    }

    fn blob(&self, id: &ShareId) -> PathBuf {
        self.dir(id).join(format!("{id}.bin"))
    }

    fn meta(&self, id: &ShareId) -> PathBuf {
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
        if fs::try_exists(self.meta(id)).await? {
            return Err(StorageError::Exists);
        }
        write_atomically(&self.blob(id), &blob).await?;
        write_atomically(&self.meta(id), &serde_json::to_vec(&meta)?).await?;
        Ok(())
    }

    async fn get(&self, id: &ShareId) -> Result<Option<(Bytes, ShareMeta)>, StorageError> {
        let Some(meta) = read(&self.meta(id)).await? else {
            return Ok(None);
        };
        let meta: ShareMeta = serde_json::from_slice(&meta)?;
        // Gone between the two reads: deleted, which is an answer, not an error.
        Ok(read(&self.blob(id))
            .await?
            .map(|blob| (Bytes::from(blob), meta)))
    }

    async fn delete(&self, id: &ShareId) -> Result<bool, StorageError> {
        let existed = remove(&self.meta(id)).await?;
        if existed {
            remove(&self.blob(id)).await?;
        }
        Ok(existed)
    }

    async fn sweep(&self, now: Timestamp) -> Result<u64, StorageError> {
        let mut swept = 0;
        let mut dirs = match fs::read_dir(&self.root).await {
            Ok(dirs) => dirs,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(e.into()),
        };
        while let Some(dir) = dirs.next_entry().await? {
            if !dir.file_type().await?.is_dir() {
                continue;
            }
            let mut files = fs::read_dir(dir.path()).await?;
            while let Some(file) = files.next_entry().await? {
                let path = file.path();
                let name = file.file_name();
                let Some(name) = name.to_str() else { continue };

                let share = |suffix| {
                    name.strip_suffix(suffix)
                        .and_then(|s: &str| s.parse::<ShareId>().ok())
                };
                if let Some(id) = share(".meta.json") {
                    // Unreadable metadata is left for a person to look at.
                    let expired = read(&path).await?.and_then(|bytes| {
                        serde_json::from_slice::<ShareMeta>(&bytes)
                            .ok()
                            .map(|m| m.expired(now))
                    });
                    if expired == Some(true) && self.delete(&id).await? {
                        swept += 1;
                    }
                    continue;
                }
                // A blob without its metadata, or a temporary file.
                let orphan = match share(".bin") {
                    Some(id) => !fs::try_exists(self.meta(&id)).await?,
                    None => name.ends_with(".bin.tmp") || name.ends_with(".meta.json.tmp"),
                };
                if orphan && is_debris(&path).await {
                    remove(&path).await?;
                }
            }
        }
        Ok(swept)
    }
}
