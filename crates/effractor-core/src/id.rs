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

/// An id that is all digits, where the newer id types refuse one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DigitsOnly(pub String);

impl fmt::Display for DigitsOnly {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{:?} is not a valid id here: it needs at least one letter or '-', \
             so that no reader can take it for a number",
            self.0
        )
    }
}

impl std::error::Error for DigitsOnly {}

/// Why an architecture id was refused: the old grammar, or the newer rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArchitectureIdError {
    Grammar(IdError),
    Digits(DigitsOnly),
}

impl fmt::Display for ArchitectureIdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Grammar(e) => e.fmt(f),
            Self::Digits(e) => e.fmt(f),
        }
    }
}

impl std::error::Error for ArchitectureIdError {}

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

/// The architecture's id types keep the grammar and add one rule: at least one
/// non-digit. JavaScript reorders integer-like keys of an object ahead of the
/// others, and the order of these maps is the author's.
macro_rules! architecture_id_type {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(String);

        impl $name {
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl FromStr for $name {
            type Err = ArchitectureIdError;
            fn from_str(s: &str) -> Result<Self, ArchitectureIdError> {
                if !is_valid(s) {
                    Err(ArchitectureIdError::Grammar(IdError(s.to_owned())))
                } else if s.bytes().all(|b| b.is_ascii_digit()) {
                    Err(ArchitectureIdError::Digits(DigitsOnly(s.to_owned())))
                } else {
                    Ok(Self(s.to_owned()))
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

architecture_id_type!(EntityId);
architecture_id_type!(AssociationId);
architecture_id_type!(FlowId);
architecture_id_type!(ScenarioId);
architecture_id_type!(ClusterId);
