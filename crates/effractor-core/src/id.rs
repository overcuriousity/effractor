use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdError(pub String);

impl fmt::Display for IdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:?} is not a valid id: use a-z, 0-9 and '-', not starting with '-'",
            self.0
        )
    }
}

impl std::error::Error for IdError {}

/// `[a-z0-9][a-z0-9-]*` — safe as a YAML key without quoting, as a URL
/// fragment and as a CSS class, so an id is the same string everywhere.
fn is_valid(s: &str) -> bool {
    let mut bytes = s.bytes();
    matches!(bytes.next(), Some(b'a'..=b'z' | b'0'..=b'9'))
        && bytes.all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'-'))
}

/// Three id types rather than one, so a consequence cannot name a node where
/// it means an asset and have it compile.
macro_rules! id_type {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(String);

        impl $name {
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl FromStr for $name {
            type Err = IdError;
            fn from_str(s: &str) -> Result<Self, IdError> {
                if is_valid(s) {
                    Ok(Self(s.to_owned()))
                } else {
                    Err(IdError(s.to_owned()))
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

id_type!(NodeId);
id_type!(AssetId);
id_type!(ControlId);
