use std::collections::HashMap;
use std::net::IpAddr;

use super::Timestamp;

/// A token bucket per address: `per_hour` shares at once, refilled evenly over
/// the hour. In memory and per process, which is all a single binary needs; it
/// forgets on restart, and that errs towards letting people share.
pub struct Limiter {
    per_hour: u32,
    buckets: HashMap<[u8; 8], Bucket>,
}

struct Bucket {
    tokens: f64,
    at: Timestamp,
}

/// Addresses tracked before the full buckets — which say nothing — are dropped.
const PRUNE_AT: usize = 10_000;

impl Limiter {
    pub fn new(per_hour: u32) -> Self {
        Self {
            per_hour,
            buckets: HashMap::new(),
        }
    }

    /// A v6 host owns its /64, so that is what is counted; a v4 address is
    /// counted whole.
    fn key(ip: IpAddr) -> [u8; 8] {
        let mut key = [0u8; 8];
        match ip {
            IpAddr::V4(v4) => key[..4].copy_from_slice(&v4.octets()),
            IpAddr::V6(v6) => key.copy_from_slice(&v6.octets()[..8]),
        }
        key
    }

    /// Take one token, or say how many seconds until there is one.
    pub fn take(&mut self, ip: IpAddr, now: Timestamp) -> Result<(), u64> {
        let capacity = f64::from(self.per_hour);
        let per_second = capacity / 3600.0;
        if self.buckets.len() >= PRUNE_AT {
            self.buckets
                .retain(|_, b| b.tokens + now.saturating_sub(b.at) as f64 * per_second < capacity);
        }
        let bucket = self.buckets.entry(Self::key(ip)).or_insert(Bucket {
            tokens: capacity,
            at: now,
        });
        bucket.tokens =
            (bucket.tokens + now.saturating_sub(bucket.at) as f64 * per_second).min(capacity);
        bucket.at = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else if per_second > 0.0 {
            Err(((1.0 - bucket.tokens) / per_second).ceil() as u64)
        } else {
            Err(3600)
        }
    }
}
