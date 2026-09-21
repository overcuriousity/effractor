use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use axum::body::Bytes;

use super::{ShareId, ShareMeta, Storage, StorageError, Timestamp};

/// Shares that last as long as the process: for tests, and as the smallest
/// thing that keeps the `Storage` contract.
#[derive(Default)]
pub struct MemoryStorage {
    shares: Mutex<HashMap<ShareId, (Bytes, ShareMeta)>>,
}

impl MemoryStorage {
    fn shares(&self) -> std::sync::MutexGuard<'_, HashMap<ShareId, (Bytes, ShareMeta)>> {
        // A panic while holding the lock cannot leave the map half-written.
        self.shares.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[async_trait]
impl Storage for MemoryStorage {
    async fn put(&self, id: &ShareId, blob: Bytes, meta: ShareMeta) -> Result<(), StorageError> {
        let mut shares = self.shares();
        if shares.contains_key(id) {
            return Err(StorageError::Exists);
        }
        shares.insert(id.clone(), (blob, meta));
        Ok(())
    }

    async fn get(&self, id: &ShareId) -> Result<Option<(Bytes, ShareMeta)>, StorageError> {
        Ok(self.shares().get(id).cloned())
    }

    async fn delete(&self, id: &ShareId) -> Result<bool, StorageError> {
        Ok(self.shares().remove(id).is_some())
    }

    async fn sweep(&self, now: Timestamp) -> Result<u64, StorageError> {
        let mut shares = self.shares();
        let before = shares.len();
        shares.retain(|_, (_, meta)| !meta.expired(now));
        Ok((before - shares.len()) as u64)
    }
}
