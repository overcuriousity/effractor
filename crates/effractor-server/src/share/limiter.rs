use std::collections::HashMap;
use std::net::IpAddr;

use super::Timestamp;

/// A token bucket per address: `per_hour` shares at once, refilled evenly over
/// the hour. In memory and per process, which is all a single binary needs; it
/// forgets on restart, and that errs towards letting people share.
pub struct Limiter {
    per_hour: u32,
    buckets: HashMap<Key, Bucket>,
}

/// Tagged by family, so a v6 prefix never shares a bucket with the v4 address
/// its first bytes happen to spell.
#[derive(PartialEq, Eq, Hash)]
enum Key {
    V4([u8; 4]),
    V6([u8; 8]),
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
    /// counted whole — including one a dual-stack listener reports as
    /// `::ffff:a.b.c.d`, which would otherwise put every v4 client in one /64.
    fn key(ip: IpAddr) -> Key {
        match ip.to_canonical() {
            IpAddr::V4(v4) => Key::V4(v4.octets()),
            IpAddr::V6(v6) => {
                let mut prefix = [0u8; 8];
                prefix.copy_from_slice(&v6.octets()[..8]);
                Key::V6(prefix)
            }
        }
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

    /// Return a token taken for something that then failed on our side.
    pub fn give_back(&mut self, ip: IpAddr) {
        let capacity = f64::from(self.per_hour);
        if let Some(bucket) = self.buckets.get_mut(&Self::key(ip)) {
            bucket.tokens = (bucket.tokens + 1.0).min(capacity);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exhaust(limiter: &mut Limiter, ip: &str) {
        let ip: IpAddr = ip.parse().unwrap();
        assert!(limiter.take(ip, 0).is_ok());
        assert!(limiter.take(ip, 0).is_err());
    }

    fn free(limiter: &mut Limiter, ip: &str) -> bool {
        limiter.take(ip.parse().unwrap(), 0).is_ok()
    }

    #[test]
    fn a_dual_stack_listener_still_counts_v4_clients_apart() {
        // `[::]` reports a v4 peer as `::ffff:a.b.c.d`.
        let mut limiter = Limiter::new(1);
        exhaust(&mut limiter, "::ffff:192.0.2.1");
        assert!(free(&mut limiter, "::ffff:192.0.2.2"));
        // And it is the same client as the plain v4 address.
        assert!(!free(&mut limiter, "192.0.2.1"));
    }

    #[test]
    fn a_v6_prefix_that_spells_a_v4_address_is_another_client() {
        let mut limiter = Limiter::new(1);
        exhaust(&mut limiter, "192.0.2.1");
        // Its first eight bytes are c0 00 02 01 00 00 00 00.
        assert!(free(&mut limiter, "c000:201::1"));
    }

    #[test]
    fn a_v6_host_is_its_64() {
        let mut limiter = Limiter::new(1);
        exhaust(&mut limiter, "2001:db8:1:2::1");
        assert!(!free(&mut limiter, "2001:db8:1:2:ffff::9"));
        assert!(free(&mut limiter, "2001:db8:1:3::1"));
    }
}
