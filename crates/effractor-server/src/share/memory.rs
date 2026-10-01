use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use axum::body::Bytes;

use super::{ShareId, ShareMeta, Storage, StorageError, Timestamp};

/// Shares that last as long as the process: for tests, and as the smallest
/// thing that keeps the `Storage` contract.
#[derive(Default)]
pub struct MemoryStorage {
    shares: Mutex<Kept>,
}

/// The shares, and the bytes of their blobs.
#[derive(Default)]
struct Kept {
    map: HashMap<ShareId, (Bytes, ShareMeta)>,
    used: u64,
}

impl MemoryStorage {
    fn shares(&self) -> std::sync::MutexGuard<'_, Kept> {
        // A panic while holding the lock cannot leave the map half-written.
        self.shares.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[async_trait]
impl Storage for MemoryStorage {
    async fn put(&self, id: &ShareId, blob: Bytes, meta: ShareMeta) -> Result<(), StorageError> {
        let mut shares = self.shares();
        if shares.map.contains_key(id) {
            return Err(StorageError::Exists);
        }
        shares.used += blob.len() as u64;
        shares.map.insert(id.clone(), (blob, meta));
        Ok(())
    }

    async fn get(&self, id: &ShareId) -> Result<Option<(Bytes, ShareMeta)>, StorageError> {
        Ok(self.shares().map.get(id).cloned())
    }

    async fn meta(&self, id: &ShareId) -> Result<Option<ShareMeta>, StorageError> {
        Ok(self.shares().map.get(id).map(|(_, meta)| meta.clone()))
    }

    async fn delete(&self, id: &ShareId) -> Result<bool, StorageError> {
        let mut shares = self.shares();
        let Some((blob, _)) = shares.map.remove(id) else {
            return Ok(false);
        };
        shares.used -= blob.len() as u64;
        Ok(true)
    }

    async fn sweep(&self, now: Timestamp) -> Result<u64, StorageError> {
        let mut shares = self.shares();
        let before = shares.map.len();
        shares.map.retain(|_, (_, meta)| !meta.expired(now));
        shares.used = shares.map.values().map(|(b, _)| b.len() as u64).sum();
        Ok((before - shares.map.len()) as u64)
    }

    fn used(&self) -> u64 {
        self.shares().used
    }
}
